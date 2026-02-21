import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { AmazonClientService } from '@/modules/amazon-client';
import { ReportsService } from '@/modules/reports/reports.service';
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
import { eq, and, count, sql, inArray } from 'drizzle-orm';
import { Marketplace } from '@/config/amazon';

export type SyncType = 'full' | 'incremental';
export type SyncEntity = 'profiles' | 'portfolios' | 'campaigns' | 'ad_groups' | 'keywords' | 'product_targets' | 'reports';
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
    private reportsService: ReportsService,
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

      // Sync keywords + product targets en PARALLÈLE (les deux dépendent de campaigns + ad_groups, mais pas l'un de l'autre)
      const syncKeywords = entitiesToSync.includes('keywords');
      const syncTargets = entitiesToSync.includes('product_targets');

      if (syncKeywords || syncTargets) {
        const parallelTasks: Promise<void>[] = [];

        if (syncKeywords) {
          parallelTasks.push((async () => {
            for (const profile of profilesToSync) {
              const keywordResult = await this.syncKeywords(adAccountId, profile, syncType);
              result.recordsFetched += keywordResult.fetched;
              result.recordsCreated += keywordResult.created;
              result.recordsUpdated += keywordResult.updated;
              result.recordsFailed += keywordResult.failed;
              result.details![`keywords_${profile.marketplace}`] = keywordResult;
            }
          })());
        }

        if (syncTargets) {
          parallelTasks.push((async () => {
            for (const profile of profilesToSync) {
              const targetResult = await this.syncProductTargets(adAccountId, profile, syncType);
              result.recordsFetched += targetResult.fetched;
              result.recordsCreated += targetResult.created;
              result.recordsUpdated += targetResult.updated;
              result.recordsFailed += targetResult.failed;
              result.details![`product_targets_${profile.marketplace}`] = targetResult;
            }
          })());
        }

        await Promise.all(parallelTasks);
      }

      // Demander les rapports de performance (async – ne bloque pas le sync structurel)
      if (entitiesToSync.includes('reports')) {
        try {
          const reportResult = await this.reportsService.requestReportsForAccount(adAccountId);
          result.details!.reports = {
            requested: reportResult.jobs.length,
            skipped: reportResult.skipped.length,
            message: 'Reports requested – call POST /api/reports/process to poll & ingest',
          };
          this.logger.log(`Reports requested: ${reportResult.jobs.length} jobs created for ad account ${adAccountId}`);
        } catch (err) {
          this.logger.warn(
            `Reports request failed for ad account ${adAccountId}: ${err instanceof Error ? err.message : err}`,
          );
          result.details!.reports = { skipped: true, reason: 'request_failed' };
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
   * Synchronise les campagnes pour un profil (optimisé avec batch lookups)
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

    // Batch: pré-charger toutes les campagnes existantes pour ce profil
    const existingCampaigns = await this.db
      .select({ id: campaigns.id, amazonCampaignId: campaigns.amazonCampaignId })
      .from(campaigns)
      .where(eq(campaigns.profileId, profile.id));
    const existingCampaignMap = new Map<number, string>();
    for (const c of existingCampaigns) {
      existingCampaignMap.set(c.amazonCampaignId, c.id);
    }

    // Batch: pré-charger tous les portfolios pour ce profil
    const existingPortfolios = await this.db
      .select({ id: portfolios.id, amazonPortfolioId: portfolios.amazonPortfolioId })
      .from(portfolios)
      .where(eq(portfolios.profileId, profile.id));
    const portfolioMap = new Map<number, string>();
    for (const p of existingPortfolios) {
      portfolioMap.set(p.amazonPortfolioId, p.id);
    }

    for (const campaign of amazonCampaigns) {
      const existingId = existingCampaignMap.get(campaign.campaignId);
      const portfolioDbId = campaign.portfolioId ? (portfolioMap.get(campaign.portfolioId) || null) : null;

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

      if (!existingId) {
        await this.db.insert(campaigns).values({ ...campaignData, createdAt: new Date() });
        created++;
      } else {
        await this.db.update(campaigns).set(campaignData).where(eq(campaigns.id, existingId));
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
   * Synchronise les ad groups pour un profil (optimisé avec batch lookups)
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

    // Batch: pré-charger toutes les campagnes pour ce profil → Map(amazonCampaignId → dbId)
    const profileCampaigns = await this.db
      .select({ id: campaigns.id, amazonCampaignId: campaigns.amazonCampaignId })
      .from(campaigns)
      .where(eq(campaigns.profileId, profile.id));
    const campaignMap = new Map<number, string>();
    for (const c of profileCampaigns) {
      campaignMap.set(c.amazonCampaignId, c.id);
    }

    // Batch: pré-charger tous les ad groups existants pour ces campagnes
    const campaignDbIds = Array.from(campaignMap.values());
    let existingAdGroupMap = new Map<string, string>(); // "campaignId:amazonAdGroupId" → dbId
    if (campaignDbIds.length > 0) {
      const existingAGs = await this.db
        .select({ id: adGroups.id, campaignId: adGroups.campaignId, amazonAdGroupId: adGroups.amazonAdGroupId })
        .from(adGroups)
        .where(inArray(adGroups.campaignId, campaignDbIds));
      for (const ag of existingAGs) {
        existingAdGroupMap.set(`${ag.campaignId}:${ag.amazonAdGroupId}`, ag.id);
      }
    }

    for (const adGroup of amazonAdGroups) {
      try {
        const campaignDbId = campaignMap.get(adGroup.campaignId);
        if (!campaignDbId) {
          addSkip('missing_campaign');
          continue;
        }

        const existingId = existingAdGroupMap.get(`${campaignDbId}:${adGroup.adGroupId}`);

        const adGroupData = {
          campaignId: campaignDbId,
          amazonAdGroupId: adGroup.adGroupId,
          name: adGroup.name,
          state: adGroup.state?.toLowerCase() || 'enabled',
          defaultBid: adGroup.defaultBid ? String(adGroup.defaultBid) : null,
          lastSyncedAt: new Date(),
          rawData: adGroup,
          updatedAt: new Date(),
        };

        if (!existingId) {
          const [inserted] = await this.db.insert(adGroups).values({ ...adGroupData, createdAt: new Date() }).returning({ id: adGroups.id });
          // Ajouter au map pour les syncs suivants (keywords/targets en dépendent)
          if (inserted) existingAdGroupMap.set(`${campaignDbId}:${adGroup.adGroupId}`, inserted.id);
          stats.created++;
        } else {
          await this.db.update(adGroups).set(adGroupData).where(eq(adGroups.id, existingId));
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
   * Synchronise les keywords pour un profil (optimisé avec batch lookups)
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

    // Batch: pré-charger campagnes → Map(amazonCampaignId → dbId)
    const profileCampaigns = await this.db
      .select({ id: campaigns.id, amazonCampaignId: campaigns.amazonCampaignId })
      .from(campaigns)
      .where(eq(campaigns.profileId, profile.id));
    const campaignMap = new Map<number, string>();
    for (const c of profileCampaigns) {
      campaignMap.set(c.amazonCampaignId, c.id);
    }

    // Batch: pré-charger ad groups → Map("campaignId:amazonAdGroupId" → dbId)
    const campaignDbIds = Array.from(campaignMap.values());
    const adGroupMap = new Map<string, string>();
    if (campaignDbIds.length > 0) {
      const allAdGroups = await this.db
        .select({ id: adGroups.id, campaignId: adGroups.campaignId, amazonAdGroupId: adGroups.amazonAdGroupId })
        .from(adGroups)
        .where(inArray(adGroups.campaignId, campaignDbIds));
      for (const ag of allAdGroups) {
        adGroupMap.set(`${ag.campaignId}:${ag.amazonAdGroupId}`, ag.id);
      }
    }

    // Batch: pré-charger keywords existants → Map("adGroupId:amazonKeywordId" → dbId)
    const adGroupDbIds = Array.from(adGroupMap.values());
    const existingKeywordMap = new Map<string, string>();
    if (adGroupDbIds.length > 0) {
      const existingKWs = await this.db
        .select({ id: keywords.id, adGroupId: keywords.adGroupId, amazonKeywordId: keywords.amazonKeywordId })
        .from(keywords)
        .where(inArray(keywords.adGroupId, adGroupDbIds));
      for (const kw of existingKWs) {
        existingKeywordMap.set(`${kw.adGroupId}:${kw.amazonKeywordId}`, kw.id);
      }
    }

    for (const keyword of amazonKeywords) {
      try {
        const campaignDbId = campaignMap.get(keyword.campaignId);
        if (!campaignDbId) {
          addSkip('missing_campaign');
          continue;
        }

        const adGroupDbId = adGroupMap.get(`${campaignDbId}:${keyword.adGroupId}`);
        if (!adGroupDbId) {
          addSkip('missing_ad_group');
          continue;
        }

        const existingId = existingKeywordMap.get(`${adGroupDbId}:${keyword.keywordId}`);

        const keywordData = {
          adGroupId: adGroupDbId,
          amazonKeywordId: keyword.keywordId,
          keywordText: keyword.keywordText,
          matchType: keyword.matchType?.toLowerCase() || 'broad',
          state: keyword.state?.toLowerCase() || 'enabled',
          bid: keyword.bid ? String(keyword.bid) : null,
          lastSyncedAt: new Date(),
          rawData: keyword,
          updatedAt: new Date(),
        };

        if (!existingId) {
          await this.db.insert(keywords).values({ ...keywordData, createdAt: new Date() });
          stats.created++;
        } else {
          await this.db.update(keywords).set(keywordData).where(eq(keywords.id, existingId));
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
   * Synchronise les product targets pour un profil (optimisé avec batch lookups)
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

    // Batch: pré-charger campagnes → Map(amazonCampaignId → dbId)
    const profileCampaigns = await this.db
      .select({ id: campaigns.id, amazonCampaignId: campaigns.amazonCampaignId })
      .from(campaigns)
      .where(eq(campaigns.profileId, profile.id));
    const campaignMap = new Map<number, string>();
    for (const c of profileCampaigns) {
      campaignMap.set(c.amazonCampaignId, c.id);
    }

    // Batch: pré-charger ad groups → Map("campaignId:amazonAdGroupId" → dbId)
    const campaignDbIds = Array.from(campaignMap.values());
    const adGroupMap = new Map<string, string>();
    if (campaignDbIds.length > 0) {
      const allAdGroups = await this.db
        .select({ id: adGroups.id, campaignId: adGroups.campaignId, amazonAdGroupId: adGroups.amazonAdGroupId })
        .from(adGroups)
        .where(inArray(adGroups.campaignId, campaignDbIds));
      for (const ag of allAdGroups) {
        adGroupMap.set(`${ag.campaignId}:${ag.amazonAdGroupId}`, ag.id);
      }
    }

    // Batch: pré-charger targets existants → Map("adGroupId:amazonTargetId" → dbId)
    const adGroupDbIds = Array.from(adGroupMap.values());
    const existingTargetMap = new Map<string, string>();
    if (adGroupDbIds.length > 0) {
      const existingTGs = await this.db
        .select({ id: productTargets.id, adGroupId: productTargets.adGroupId, amazonTargetId: productTargets.amazonTargetId })
        .from(productTargets)
        .where(inArray(productTargets.adGroupId, adGroupDbIds));
      for (const tg of existingTGs) {
        existingTargetMap.set(`${tg.adGroupId}:${tg.amazonTargetId}`, tg.id);
      }
    }

    for (const target of amazonTargets) {
      try {
        const campaignDbId = campaignMap.get(target.campaignId);
        if (!campaignDbId) {
          addSkip('missing_campaign');
          continue;
        }

        const adGroupDbId = adGroupMap.get(`${campaignDbId}:${target.adGroupId}`);
        if (!adGroupDbId) {
          addSkip('missing_ad_group');
          continue;
        }

        const existingId = existingTargetMap.get(`${adGroupDbId}:${target.targetId}`);

        const targetData = {
          adGroupId: adGroupDbId,
          amazonTargetId: target.targetId,
          expressionType: target.expressionType || 'manual',
          expression: target.expression || [],
          state: target.state?.toLowerCase() || 'enabled',
          bid: target.bid ? String(target.bid) : null,
          lastSyncedAt: new Date(),
          rawData: target,
          updatedAt: new Date(),
        };

        if (!existingId) {
          await this.db.insert(productTargets).values({ ...targetData, createdAt: new Date() });
          stats.created++;
        } else {
          await this.db.update(productTargets).set(targetData).where(eq(productTargets.id, existingId));
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
