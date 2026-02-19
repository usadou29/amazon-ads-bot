import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { AmazonClientService } from '@/modules/amazon-client';
import {
  syncLogs,
  marketplaceProfiles,
  portfolios,
  campaigns,
  adGroups,
  keywords,
  productTargets,
  adAccounts,
} from '@/db/schema';
import { eq, and, count, sql } from 'drizzle-orm';
import { Marketplace } from '@/config/amazon';

export type SyncType = 'full' | 'incremental';
export type SyncEntity = 'profiles' | 'portfolios' | 'campaigns' | 'ad_groups' | 'keywords' | 'product_targets';
export type SyncStatus = 'running' | 'success' | 'partial' | 'failed';

export interface SyncOptions {
  adAccountId: string;
  profileId?: string;
  syncType: SyncType;
  entities?: SyncEntity[];
}

export interface EntitySyncStats {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  skipReasons?: Record<string, number>;
}

export interface SyncResult {
  syncLogId: string;
  status: SyncStatus;
  recordsFetched: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  durationSeconds: number;
  errors?: any[];
  details?: Record<string, any>;
}

export interface SyncStatusResponse {
  adAccountId: string;
  lastSyncAt: Date | null;
  currentSync: {
    id: string;
    jobName: string;
    status: SyncStatus;
    startedAt: Date;
    recordsFetched: number;
    recordsCreated: number;
    recordsUpdated: number;
  } | null;
  recentSyncs: Array<{
    id: string;
    jobName: string;
    status: SyncStatus;
    startedAt: Date;
    finishedAt: Date | null;
    durationSeconds: number | null;
    recordsFetched: number;
    recordsCreated: number;
    recordsUpdated: number;
    recordsFailed: number;
  }>;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private activeSyncs: Map<string, string> = new Map(); // adAccountId -> syncLogId

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
    private amazonClient: AmazonClientService,
  ) {}

  /**
   * Declenche une synchronisation complete ou incrementale
   */
  async triggerSync(options: SyncOptions): Promise<SyncResult> {
    const { adAccountId, profileId, syncType, entities } = options;
    const entitiesToSync = entities || ['profiles', 'portfolios', 'campaigns', 'ad_groups', 'keywords', 'product_targets'];

    // Verifier si une sync est deja en cours
    if (this.activeSyncs.has(adAccountId)) {
      throw new Error(`Sync already in progress for ad account ${adAccountId}`);
    }

    // Recuperer le workspace_id depuis ad_accounts (requis par sync_logs)
    const [account] = await this.db
      .select({ workspaceId: adAccounts.workspaceId })
      .from(adAccounts)
      .where(eq(adAccounts.id, adAccountId))
      .limit(1);

    if (!account) {
      throw new Error(`Ad account ${adAccountId} not found`);
    }

    if (!account.workspaceId) {
      throw new Error(`Ad account ${adAccountId} has no workspace_id`);
    }

    this.logger.log(`Sync triggered for ad account ${adAccountId} (workspace ${account.workspaceId})`);

    const startedAt = new Date();
    const jobName = `${syncType}_sync_${entitiesToSync.join('_')}`;

    // Creer l'entree de log
    const [syncLog] = await this.db.insert(syncLogs).values({
      workspaceId: account.workspaceId,
      adAccountId,
      profileId: profileId || null,
      jobName,
      jobType: syncType,
      startedAt,
      status: 'running',
      details: { entities: entitiesToSync },
    }).returning();

    this.activeSyncs.set(adAccountId, syncLog.id);

    const result: SyncResult = {
      syncLogId: syncLog.id,
      status: 'running',
      recordsFetched: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      durationSeconds: 0,
      errors: [],
      details: {},
    };

    try {
      this.logger.log(`Starting ${syncType} sync for ad account ${adAccountId}`);

      // Sync profiles si demande
      if (entitiesToSync.includes('profiles')) {
        const profileResult = await this.syncProfiles(adAccountId);
        result.recordsFetched += profileResult.fetched;
        result.recordsCreated += profileResult.created;
        result.recordsUpdated += profileResult.updated;
        result.details!.profiles = profileResult;
      }

      // Recuperer les profils a synchroniser
      let profilesToSync = await this.getProfilesToSync(adAccountId, profileId);

      // Sync portfolios (optionnel – l'API n'est pas dispo pour certains comptes ex: KDP/Author)
      if (entitiesToSync.includes('portfolios')) {
        for (const profile of profilesToSync) {
          try {
            const portfolioResult = await this.syncPortfolios(adAccountId, profile);
            result.recordsFetched += portfolioResult.fetched;
            result.recordsCreated += portfolioResult.created;
            result.recordsUpdated += portfolioResult.updated;
            result.details![`portfolios_${profile.marketplace}`] = portfolioResult;
          } catch (err) {
            this.logger.warn(
              `Portfolios sync skipped for profile ${profile.id} (${profile.marketplace}): ${err instanceof Error ? err.message : err}`,
            );
            result.details![`portfolios_${profile.marketplace}`] = { skipped: true, reason: 'api_not_available' };
          }
        }
      }

      // Sync campaigns
      if (entitiesToSync.includes('campaigns')) {
        for (const profile of profilesToSync) {
          const campaignResult = await this.syncCampaigns(adAccountId, profile, syncType);
          result.recordsFetched += campaignResult.fetched;
          result.recordsCreated += campaignResult.created;
          result.recordsUpdated += campaignResult.updated;
          result.details![`campaigns_${profile.marketplace}`] = campaignResult;
        }
      }

      // Sync ad groups (dépend de campaigns)
      if (entitiesToSync.includes('ad_groups')) {
        for (const profile of profilesToSync) {
          const adGroupResult = await this.syncAdGroups(adAccountId, profile, syncType);
          result.recordsFetched += adGroupResult.fetched;
          result.recordsCreated += adGroupResult.created;
          result.recordsUpdated += adGroupResult.updated;
          result.recordsFailed += adGroupResult.failed;
          result.details![`ad_groups_${profile.marketplace}`] = adGroupResult;
        }
      }

      // Sync keywords (dépend de campaigns + ad_groups)
      if (entitiesToSync.includes('keywords')) {
        for (const profile of profilesToSync) {
          const keywordResult = await this.syncKeywords(adAccountId, profile, syncType);
          result.recordsFetched += keywordResult.fetched;
          result.recordsCreated += keywordResult.created;
          result.recordsUpdated += keywordResult.updated;
          result.recordsFailed += keywordResult.failed;
          result.details![`keywords_${profile.marketplace}`] = keywordResult;
        }
      }

      // Sync product targets (dépend de campaigns + ad_groups)
      if (entitiesToSync.includes('product_targets')) {
        for (const profile of profilesToSync) {
          const targetResult = await this.syncProductTargets(adAccountId, profile, syncType);
          result.recordsFetched += targetResult.fetched;
          result.recordsCreated += targetResult.created;
          result.recordsUpdated += targetResult.updated;
          result.recordsFailed += targetResult.failed;
          result.details![`product_targets_${profile.marketplace}`] = targetResult;
        }
      }

      result.status = result.recordsFailed > 0 ? 'partial' : 'success';

      // Vérification post-sync : compter les lignes en base pour chaque entité synchronisée
      await this.logPostSyncCounts(adAccountId, entitiesToSync);

      // Mettre a jour le ad account
      await this.db
        .update(adAccounts)
        .set({ lastSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(adAccounts.id, adAccountId));

    } catch (error) {
      this.logger.error(`Sync failed for ad account ${adAccountId}: ${error}`);
      result.status = 'failed';
      result.errors!.push({
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    } finally {
      const finishedAt = new Date();
      result.durationSeconds = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);

      // Mettre a jour le log de sync
      await this.db
        .update(syncLogs)
        .set({
          finishedAt,
          durationSeconds: result.durationSeconds,
          status: result.status,
          recordsFetched: result.recordsFetched,
          recordsCreated: result.recordsCreated,
          recordsUpdated: result.recordsUpdated,
          recordsFailed: result.recordsFailed,
          details: result.details,
          errors: result.errors && result.errors.length > 0 ? result.errors : null,
        })
        .where(eq(syncLogs.id, syncLog.id));

      this.activeSyncs.delete(adAccountId);
    }

    this.logger.log(
      `Sync completed for ad account ${adAccountId}: ` +
      `status=${result.status}, fetched=${result.recordsFetched}, ` +
      `created=${result.recordsCreated}, updated=${result.recordsUpdated}, ` +
      `failed=${result.recordsFailed}, duration=${result.durationSeconds}s`
    );

    return result;
  }

  /**
   * Recupere le statut de synchronisation pour un ad account
   */
  async getSyncStatus(adAccountId: string): Promise<SyncStatusResponse> {
    // Recuperer le ad account
    const [account] = await this.db
      .select()
      .from(adAccounts)
      .where(eq(adAccounts.id, adAccountId))
      .limit(1);

    if (!account) {
      throw new Error(`Ad account ${adAccountId} not found`);
    }

    // Recuperer la sync en cours si elle existe
    let currentSync = null;
    const currentSyncId = this.activeSyncs.get(adAccountId);
    if (currentSyncId) {
      const [sync] = await this.db
        .select()
        .from(syncLogs)
        .where(eq(syncLogs.id, currentSyncId))
        .limit(1);

      if (sync) {
        currentSync = {
          id: sync.id,
          jobName: sync.jobName,
          status: sync.status as SyncStatus,
          startedAt: sync.startedAt,
          recordsFetched: sync.recordsFetched || 0,
          recordsCreated: sync.recordsCreated || 0,
          recordsUpdated: sync.recordsUpdated || 0,
        };
      }
    }

    // Recuperer les syncs recentes
    const recentSyncs = await this.db
      .select()
      .from(syncLogs)
      .where(eq(syncLogs.adAccountId, adAccountId))
      .orderBy(syncLogs.startedAt)
      .limit(10);

    return {
      adAccountId,
      lastSyncAt: account.lastSyncAt,
      currentSync,
      recentSyncs: recentSyncs.reverse().map((sync: any) => ({
        id: sync.id,
        jobName: sync.jobName,
        status: sync.status as SyncStatus,
        startedAt: sync.startedAt,
        finishedAt: sync.finishedAt,
        durationSeconds: sync.durationSeconds,
        recordsFetched: sync.recordsFetched || 0,
        recordsCreated: sync.recordsCreated || 0,
        recordsUpdated: sync.recordsUpdated || 0,
        recordsFailed: sync.recordsFailed || 0,
      })),
    };
  }

  // ── Mapping Amazon countryCode → marketplace DB ──
  // Amazon renvoie "GB" pour le Royaume-Uni, notre DB attend "UK".
  private static readonly COUNTRY_TO_MARKETPLACE: Record<string, string> = {
    FR: 'FR', DE: 'DE', ES: 'ES', IT: 'IT',
    GB: 'UK', UK: 'UK',
    US: 'US', CA: 'CA', AU: 'AU', JP: 'JP', MX: 'MX',
  };

  // Mapping marketplace → devise (fallback si currencyCode absent/invalide)
  private static readonly MARKETPLACE_CURRENCY: Record<string, string> = {
    FR: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR',
    UK: 'GBP', US: 'USD', CA: 'CAD', AU: 'AUD', JP: 'JPY', MX: 'MXN',
  };

  // Devises acceptées par la CHECK constraint Supabase
  private static readonly VALID_CURRENCIES = new Set([
    'EUR', 'USD', 'GBP', 'CAD', 'AUD', 'JPY', 'MXN',
  ]);

  /**
   * Synchronise les profils marketplace depuis Amazon
   */
  private async syncProfiles(adAccountId: string): Promise<{ fetched: number; created: number; updated: number }> {
    this.logger.debug(`Syncing profiles for ad account ${adAccountId}`);

    const amazonProfiles = await this.amazonClient.getProfiles(adAccountId);

    let created = 0;
    let updated = 0;

    for (const profile of amazonProfiles) {
      // Mapper countryCode → marketplace (GB → UK)
      const rawCountry = profile.countryCode?.toUpperCase();
      const marketplace = SyncService.COUNTRY_TO_MARKETPLACE[rawCountry];

      if (!marketplace) {
        this.logger.warn(
          `Skipping profile ${profile.profileId}: unknown countryCode "${rawCountry}"`,
        );
        continue;
      }

      // Résoudre la devise : d'abord currencyCode Amazon, sinon fallback par marketplace
      let currency = profile.currencyCode?.toUpperCase();
      if (!currency || !SyncService.VALID_CURRENCIES.has(currency)) {
        const fallback = SyncService.MARKETPLACE_CURRENCY[marketplace];
        this.logger.warn(
          `Profile ${profile.profileId}: currency "${profile.currencyCode}" invalid, using fallback "${fallback}"`,
        );
        currency = fallback;
      }

      this.logger.debug(
        `Profile ${profile.profileId}: country=${rawCountry} → marketplace=${marketplace}, currency=${currency}`,
      );

      const existingProfile = await this.db
        .select()
        .from(marketplaceProfiles)
        .where(
          and(
            eq(marketplaceProfiles.adAccountId, adAccountId),
            eq(marketplaceProfiles.profileId, profile.profileId),
          ),
        )
        .limit(1);

      const profileData = {
        adAccountId,
        profileId: profile.profileId,
        marketplace,
        marketplaceId: profile.accountInfo?.marketplaceStringId || null,
        currency,
        isActive: true,
        lastSyncAt: new Date(),
      };

      if (existingProfile.length === 0) {
        // INSERT
        await this.db.insert(marketplaceProfiles).values(profileData);
        created++;
      } else {
        // UPDATE
        await this.db
          .update(marketplaceProfiles)
          .set({ ...profileData, lastSyncAt: new Date() })
          .where(eq(marketplaceProfiles.id, existingProfile[0].id));
        updated++;
      }
    }

    return { fetched: amazonProfiles.length, created, updated };
  }

  /**
   * Synchronise les portfolios pour un profil
   */
  private async syncPortfolios(
    adAccountId: string,
    profile: any,
  ): Promise<{ fetched: number; created: number; updated: number }> {
    this.logger.debug(`Syncing portfolios for profile ${profile.id} (${profile.marketplace})`);

    const amazonPortfolios = await this.amazonClient.getPortfolios(
      adAccountId,
      profile.profileId,
      profile.marketplace as Marketplace,
    );

    let created = 0;
    let updated = 0;

    for (const portfolio of amazonPortfolios) {
      const existingPortfolio = await this.db
        .select()
        .from(portfolios)
        .where(
          and(
            eq(portfolios.profileId, profile.id),
            eq(portfolios.amazonPortfolioId, portfolio.portfolioId),
          ),
        )
        .limit(1);

      const portfolioData = {
        profileId: profile.id,
        amazonPortfolioId: portfolio.portfolioId,
        name: portfolio.name,
        state: portfolio.state?.toLowerCase() || null,
        budgetAmount: portfolio.budget?.amount ? String(portfolio.budget.amount) : null,
        budgetCurrency: portfolio.budget?.currencyCode || profile.currency || null,
        budgetPolicy: portfolio.budget?.policy?.toLowerCase() || null,
        lastSyncedAt: new Date(),
        rawData: portfolio,
        updatedAt: new Date(),
      };

      if (existingPortfolio.length === 0) {
        await this.db.insert(portfolios).values({
          ...portfolioData,
          createdAt: new Date(),
        });
        created++;
      } else {
        await this.db
          .update(portfolios)
          .set(portfolioData)
          .where(eq(portfolios.id, existingPortfolio[0].id));
        updated++;
      }
    }

    return { fetched: amazonPortfolios.length, created, updated };
  }

  /**
   * Synchronise les campagnes pour un profil
   */
  private async syncCampaigns(
    adAccountId: string,
    profile: any,
    syncType: SyncType,
  ): Promise<{ fetched: number; created: number; updated: number }> {
    this.logger.debug(`Syncing campaigns for profile ${profile.id} (${profile.marketplace})`);

    const amazonCampaigns = await this.amazonClient.getCampaigns(
      adAccountId,
      profile.profileId,
      profile.marketplace as Marketplace,
    );

    let created = 0;
    let updated = 0;

    for (const campaign of amazonCampaigns) {
      const existingCampaign = await this.db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.profileId, profile.id),
            eq(campaigns.amazonCampaignId, campaign.campaignId),
          ),
        )
        .limit(1);

      // Trouver le portfolio si present
      let portfolioDbId = null;
      if (campaign.portfolioId) {
        const [portfolio] = await this.db
          .select()
          .from(portfolios)
          .where(
            and(
              eq(portfolios.profileId, profile.id),
              eq(portfolios.amazonPortfolioId, campaign.portfolioId),
            ),
          )
          .limit(1);
        portfolioDbId = portfolio?.id || null;
      }

      const campaignData = {
        profileId: profile.id,
        portfolioId: portfolioDbId,
        amazonCampaignId: campaign.campaignId,
        name: campaign.name,
        campaignType: campaign.campaignType || 'sponsoredProducts',
        state: campaign.state?.toLowerCase() || 'enabled',
        targetingType: campaign.targetingType?.toLowerCase() || null,
        budgetType: campaign.budget?.budgetType?.toLowerCase() || 'daily',
        dailyBudget: campaign.budget?.budget ? String(campaign.budget.budget) : null,
        biddingStrategy: campaign.dynamicBidding?.strategy || null,
        startDate: campaign.startDate || null,
        endDate: campaign.endDate || null,
        lastSyncedAt: new Date(),
        rawData: campaign,
        updatedAt: new Date(),
      };

      if (existingCampaign.length === 0) {
        // INSERT
        await this.db.insert(campaigns).values({
          ...campaignData,
          createdAt: new Date(),
        });
        created++;
      } else {
        // UPDATE (UPSERT)
        await this.db
          .update(campaigns)
          .set(campaignData)
          .where(eq(campaigns.id, existingCampaign[0].id));
        updated++;
      }
    }

    // Mettre a jour lastSyncAt sur le profil
    await this.db
      .update(marketplaceProfiles)
      .set({ lastSyncAt: new Date() })
      .where(eq(marketplaceProfiles.id, profile.id));

    return { fetched: amazonCampaigns.length, created, updated };
  }

  /**
   * Synchronise les ad groups pour un profil
   */
  private async syncAdGroups(
    adAccountId: string,
    profile: any,
    syncType: SyncType,
  ): Promise<EntitySyncStats> {
    this.logger.debug(`Syncing ad groups for profile ${profile.id} (${profile.marketplace})`);

    const amazonAdGroups = await this.amazonClient.getAdGroups(
      adAccountId,
      profile.profileId,
      profile.marketplace as Marketplace,
    );

    const stats: EntitySyncStats = { fetched: amazonAdGroups.length, created: 0, updated: 0, skipped: 0, failed: 0, skipReasons: {} };
    const addSkip = (reason: string) => { stats.skipped++; stats.skipReasons![reason] = (stats.skipReasons![reason] || 0) + 1; };

    for (const adGroup of amazonAdGroups) {
      try {
        // Trouver la campagne parent
        const [campaign] = await this.db
          .select()
          .from(campaigns)
          .where(
            and(
              eq(campaigns.profileId, profile.id),
              eq(campaigns.amazonCampaignId, adGroup.campaignId),
            ),
          )
          .limit(1);

        if (!campaign) {
          this.logger.debug(`SKIP ad_group ${adGroup.adGroupId}: missing_campaign (amazonCampaignId=${adGroup.campaignId})`);
          addSkip('missing_campaign');
          continue;
        }

        const existingAdGroup = await this.db
          .select()
          .from(adGroups)
          .where(
            and(
              eq(adGroups.campaignId, campaign.id),
              eq(adGroups.amazonAdGroupId, adGroup.adGroupId),
            ),
          )
          .limit(1);

        const adGroupData = {
          campaignId: campaign.id,
          amazonAdGroupId: adGroup.adGroupId,
          name: adGroup.name,
          state: adGroup.state?.toLowerCase() || 'enabled',
          defaultBid: adGroup.defaultBid ? String(adGroup.defaultBid) : null,
          lastSyncedAt: new Date(),
          rawData: adGroup,
          updatedAt: new Date(),
        };

        if (existingAdGroup.length === 0) {
          await this.db.insert(adGroups).values({ ...adGroupData, createdAt: new Date() });
          stats.created++;
        } else {
          await this.db.update(adGroups).set(adGroupData).where(eq(adGroups.id, existingAdGroup[0].id));
          stats.updated++;
        }
      } catch (err) {
        stats.failed++;
        this.logger.warn(`FAIL ad_group ${adGroup.adGroupId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    this.logger.log(
      `Ad groups ${profile.marketplace}: fetched=${stats.fetched} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped} failed=${stats.failed}` +
      (stats.skipped > 0 ? ` skipReasons=${JSON.stringify(stats.skipReasons)}` : ''),
    );
    return stats;
  }

  /**
   * Synchronise les keywords pour un profil
   */
  private async syncKeywords(
    adAccountId: string,
    profile: any,
    syncType: SyncType,
  ): Promise<EntitySyncStats> {
    this.logger.debug(`Syncing keywords for profile ${profile.id} (${profile.marketplace})`);

    const amazonKeywords = await this.amazonClient.getKeywords(
      adAccountId,
      profile.profileId,
      profile.marketplace as Marketplace,
    );

    const stats: EntitySyncStats = { fetched: amazonKeywords.length, created: 0, updated: 0, skipped: 0, failed: 0, skipReasons: {} };
    const addSkip = (reason: string) => { stats.skipped++; stats.skipReasons![reason] = (stats.skipReasons![reason] || 0) + 1; };

    for (const keyword of amazonKeywords) {
      try {
        // Trouver la campagne parent
        const [campaign] = await this.db
          .select()
          .from(campaigns)
          .where(
            and(
              eq(campaigns.profileId, profile.id),
              eq(campaigns.amazonCampaignId, keyword.campaignId),
            ),
          )
          .limit(1);

        if (!campaign) {
          this.logger.debug(`SKIP keyword ${keyword.keywordId}: missing_campaign (amazonCampaignId=${keyword.campaignId})`);
          addSkip('missing_campaign');
          continue;
        }

        const [adGroup] = await this.db
          .select()
          .from(adGroups)
          .where(
            and(
              eq(adGroups.campaignId, campaign.id),
              eq(adGroups.amazonAdGroupId, keyword.adGroupId),
            ),
          )
          .limit(1);

        if (!adGroup) {
          this.logger.debug(`SKIP keyword ${keyword.keywordId}: missing_ad_group (amazonAdGroupId=${keyword.adGroupId})`);
          addSkip('missing_ad_group');
          continue;
        }

        const existingKeyword = await this.db
          .select()
          .from(keywords)
          .where(
            and(
              eq(keywords.adGroupId, adGroup.id),
              eq(keywords.amazonKeywordId, keyword.keywordId),
            ),
          )
          .limit(1);

        const keywordData = {
          adGroupId: adGroup.id,
          amazonKeywordId: keyword.keywordId,
          keywordText: keyword.keywordText,
          matchType: keyword.matchType?.toLowerCase() || 'broad',
          state: keyword.state?.toLowerCase() || 'enabled',
          bid: keyword.bid ? String(keyword.bid) : null,
          lastSyncedAt: new Date(),
          rawData: keyword,
          updatedAt: new Date(),
        };

        if (existingKeyword.length === 0) {
          await this.db.insert(keywords).values({ ...keywordData, createdAt: new Date() });
          stats.created++;
        } else {
          await this.db.update(keywords).set(keywordData).where(eq(keywords.id, existingKeyword[0].id));
          stats.updated++;
        }
      } catch (err) {
        stats.failed++;
        this.logger.warn(`FAIL keyword ${keyword.keywordId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    this.logger.log(
      `Keywords ${profile.marketplace}: fetched=${stats.fetched} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped} failed=${stats.failed}` +
      (stats.skipped > 0 ? ` skipReasons=${JSON.stringify(stats.skipReasons)}` : ''),
    );
    return stats;
  }

  /**
   * Synchronise les product targets pour un profil
   */
  private async syncProductTargets(
    adAccountId: string,
    profile: any,
    syncType: SyncType,
  ): Promise<EntitySyncStats> {
    this.logger.debug(`Syncing product targets for profile ${profile.id} (${profile.marketplace})`);

    const amazonTargets = await this.amazonClient.getProductTargets(
      adAccountId,
      profile.profileId,
      profile.marketplace as Marketplace,
    );

    const stats: EntitySyncStats = { fetched: amazonTargets.length, created: 0, updated: 0, skipped: 0, failed: 0, skipReasons: {} };
    const addSkip = (reason: string) => { stats.skipped++; stats.skipReasons![reason] = (stats.skipReasons![reason] || 0) + 1; };

    for (const target of amazonTargets) {
      try {
        const [campaign] = await this.db
          .select()
          .from(campaigns)
          .where(
            and(
              eq(campaigns.profileId, profile.id),
              eq(campaigns.amazonCampaignId, target.campaignId),
            ),
          )
          .limit(1);

        if (!campaign) {
          this.logger.debug(`SKIP target ${target.targetId}: missing_campaign (amazonCampaignId=${target.campaignId})`);
          addSkip('missing_campaign');
          continue;
        }

        const [adGroup] = await this.db
          .select()
          .from(adGroups)
          .where(
            and(
              eq(adGroups.campaignId, campaign.id),
              eq(adGroups.amazonAdGroupId, target.adGroupId),
            ),
          )
          .limit(1);

        if (!adGroup) {
          this.logger.debug(`SKIP target ${target.targetId}: missing_ad_group (amazonAdGroupId=${target.adGroupId})`);
          addSkip('missing_ad_group');
          continue;
        }

        const existingTarget = await this.db
          .select()
          .from(productTargets)
          .where(
            and(
              eq(productTargets.adGroupId, adGroup.id),
              eq(productTargets.amazonTargetId, target.targetId),
            ),
          )
          .limit(1);

        const targetData = {
          adGroupId: adGroup.id,
          amazonTargetId: target.targetId,
          expressionType: target.expressionType || 'manual',
          expression: target.expression || [],
          state: target.state?.toLowerCase() || 'enabled',
          bid: target.bid ? String(target.bid) : null,
          lastSyncedAt: new Date(),
          rawData: target,
          updatedAt: new Date(),
        };

        if (existingTarget.length === 0) {
          await this.db.insert(productTargets).values({ ...targetData, createdAt: new Date() });
          stats.created++;
        } else {
          await this.db.update(productTargets).set(targetData).where(eq(productTargets.id, existingTarget[0].id));
          stats.updated++;
        }
      } catch (err) {
        stats.failed++;
        this.logger.warn(`FAIL target ${target.targetId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    this.logger.log(
      `Product targets ${profile.marketplace}: fetched=${stats.fetched} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped} failed=${stats.failed}` +
      (stats.skipped > 0 ? ` skipReasons=${JSON.stringify(stats.skipReasons)}` : ''),
    );
    return stats;
  }

  /**
   * Vérification post-sync : log le nombre de lignes en base pour chaque entité
   */
  private async logPostSyncCounts(adAccountId: string, entities: string[]): Promise<void> {
    try {
      // Récupérer les profils liés à ce ad account
      const profileIds = await this.db
        .select({ id: marketplaceProfiles.id })
        .from(marketplaceProfiles)
        .where(eq(marketplaceProfiles.adAccountId, adAccountId));

      const profileIdList = profileIds.map((p: any) => p.id);

      if (profileIdList.length === 0) {
        this.logger.log(`[POST-SYNC COUNT] No profiles found for ad account ${adAccountId}`);
        return;
      }

      const counts: Record<string, number> = {};

      if (entities.includes('profiles')) {
        const [row] = await this.db
          .select({ total: count() })
          .from(marketplaceProfiles)
          .where(eq(marketplaceProfiles.adAccountId, adAccountId));
        counts.profiles = row?.total ?? 0;
      }

      if (entities.includes('portfolios')) {
        const [row] = await this.db
          .select({ total: count() })
          .from(portfolios)
          .where(sql`${portfolios.profileId} IN (${sql.join(profileIdList.map((id: string) => sql`${id}`), sql`, `)})`);
        counts.portfolios = row?.total ?? 0;
      }

      if (entities.includes('campaigns')) {
        const [row] = await this.db
          .select({ total: count() })
          .from(campaigns)
          .where(sql`${campaigns.profileId} IN (${sql.join(profileIdList.map((id: string) => sql`${id}`), sql`, `)})`);
        counts.campaigns = row?.total ?? 0;
      }

      if (entities.includes('ad_groups')) {
        const [row] = await this.db
          .select({ total: count() })
          .from(adGroups)
          .where(sql`${adGroups.campaignId} IN (
            SELECT id FROM campaigns WHERE ${campaigns.profileId} IN (${sql.join(profileIdList.map((id: string) => sql`${id}`), sql`, `)})
          )`);
        counts.ad_groups = row?.total ?? 0;
      }

      if (entities.includes('keywords')) {
        const [row] = await this.db
          .select({ total: count() })
          .from(keywords)
          .where(sql`${keywords.adGroupId} IN (
            SELECT ag.id FROM ad_groups ag
            INNER JOIN campaigns c ON ag.campaign_id = c.id
            WHERE c.profile_id IN (${sql.join(profileIdList.map((id: string) => sql`${id}`), sql`, `)})
          )`);
        counts.keywords = row?.total ?? 0;
      }

      if (entities.includes('product_targets')) {
        const [row] = await this.db
          .select({ total: count() })
          .from(productTargets)
          .where(sql`${productTargets.adGroupId} IN (
            SELECT ag.id FROM ad_groups ag
            INNER JOIN campaigns c ON ag.campaign_id = c.id
            WHERE c.profile_id IN (${sql.join(profileIdList.map((id: string) => sql`${id}`), sql`, `)})
          )`);
        counts.product_targets = row?.total ?? 0;
      }

      this.logger.log(
        `[POST-SYNC COUNT] Ad account ${adAccountId}: ` +
        Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', '),
      );
    } catch (err) {
      this.logger.warn(`[POST-SYNC COUNT] Failed to count: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Recupere les profils a synchroniser
   */
  private async getProfilesToSync(adAccountId: string, profileId?: string): Promise<any[]> {
    if (profileId) {
      const [profile] = await this.db
        .select()
        .from(marketplaceProfiles)
        .where(eq(marketplaceProfiles.id, profileId))
        .limit(1);
      return profile ? [profile] : [];
    }

    return this.db
      .select()
      .from(marketplaceProfiles)
      .where(
        and(
          eq(marketplaceProfiles.adAccountId, adAccountId),
          eq(marketplaceProfiles.isActive, true),
        ),
      );
  }
}
