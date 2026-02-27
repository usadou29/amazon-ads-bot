import { Injectable, Inject, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import {
  books,
  campaigns,
  adGroups,
  keywords,
  campaignBookMapping,
  actionLog,
  marketplaceProfiles,
  adAccounts,
} from '@/db/schema';
import { eq, and, inArray, gte } from 'drizzle-orm';
import { AmazonClientService } from '@/modules/amazon-client/amazon-client.service';
import { createHash } from 'crypto';
import {
  LIFECYCLE_DEFAULTS,
  BUDGET_GUARDS,
  BID_GUARDS,
  PAUSE_BATCH_CONFIG,
} from './constants';
import type { PauseBatchDto, PauseBatchResult, PauseAllForBookResult } from './campaign-evolution.types';

// ── DTOs ────────────────────────────────────────────────────────

export interface CreateFromPlanDto {
  workspaceId: string;
  bookId: string;
  planActionType: string;
  planPayload: {
    campaignType?: string;
    targetingType?: string;
    matchTypes?: string[];
    dailyBudget?: number;
    keywords?: string[];
    asins?: string[];
  };
  lifecyclePhase?: string;
  strategicPeriodDays?: number;
}

export interface CreateFromPlanResult {
  success: boolean;
  campaignName: string;
  amazonCampaignId?: number;
  amazonAdGroupId?: number;
  dbCampaignId?: string;
  keywordsCreated?: number;
  fingerprint: string;
  message: string;
  alreadyCreated?: boolean;
  existingCampaignLink?: string;
}

// ── Batch DTOs ───────────────────────────────────────────────

export interface BatchCampaignOverride {
  /** Index in the creationPlan.campaignsToCreate array */
  index: number;
  /** Override daily budget (optional) */
  dailyBudget?: number;
  /** Override bidding strategy (optional) */
  biddingStrategy?: string;
  /** Override seed keywords (optional) */
  seedKeywords?: string[];
  /** Skip this campaign (optional) */
  skip?: boolean;
}

export interface BatchCreateFromPlanDto {
  workspaceId: string;
  bookId: string;
  planId: string;
  fingerprint: string;
  lifecyclePhase?: string;
  /** Campaign definitions from creationPlan */
  campaigns: Array<{
    name: string;
    type: string;
    targetingMode: 'AUTO' | 'MANUAL';
    dailyBudget: number;
    defaultBid?: number;
    biddingStrategy: string;
    placementAdjustments?: { topOfSearch: number; restOfSearch: number; productPages: number };
    seedKeywords?: string[];
    seedAsins?: string[];
    negativeKeywords?: string[];
    notesWhy: string;
    explanations?: Array<{ parameter: string; value: string; reasoning: string; dataSource: string }>;
  }>;
  /** Optional overrides per campaign */
  overrides?: BatchCampaignOverride[];
}

export interface BatchCampaignResult {
  index: number;
  name: string;
  success: boolean;
  amazonCampaignId?: number;
  dbCampaignId?: string;
  message: string;
  alreadyCreated?: boolean;
  skipped?: boolean;
}

export interface BatchCreateFromPlanResult {
  planId: string;
  fingerprint: string;
  totalRequested: number;
  totalCreated: number;
  totalSkipped: number;
  totalFailed: number;
  results: BatchCampaignResult[];
  message: string;
}

// ── Error types for granular handling ─────────────────────────

type AmazonErrorCode = 'TOKEN_EXPIRED' | 'RATE_LIMITED' | 'TIMEOUT' | 'PARTIAL_FAILURE' | 'UNKNOWN';

interface AmazonApiError {
  code: AmazonErrorCode;
  message: string;
  retryable: boolean;
  statusCode?: number;
}

// ── Compensation log entry ────────────────────────────────────

interface CompensationEntry {
  step: string;
  amazonId?: number;
  dbId?: string;
  status: 'created' | 'failed' | 'rolled_back';
  error?: string;
}

// ── Lock TTL ──────────────────────────────────────────────────

const IDEMPOTENCE_TTL_DAYS = 30;
const LOCK_TIMEOUT_MS = 60_000;

@Injectable()
export class CreateFromPlanService {
  private readonly logger = new Logger(CreateFromPlanService.name);

  /**
   * In-memory lock to prevent double-click: fingerprint → timestamp
   * In production, this should be a Redis SETNX or pg advisory lock.
   */
  private readonly pendingLocks = new Map<string, number>();

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly amazonClient: AmazonClientService,
  ) {}

  // ── Main Entry Point ──────────────────────────────────────────

  async createCampaignFromPlan(dto: CreateFromPlanDto): Promise<CreateFromPlanResult> {
    // 1. Validate inputs + apply lifecycle guards
    this.validate(dto);
    this.applyLifecycleDefaults(dto);
    this.applyGuards(dto);

    // 2. Compute fingerprint for idempotence
    const fingerprint = this.computeFingerprint(dto);

    // 3. Check idempotence: has this exact plan been executed within TTL?
    const existing = await this.checkIdempotence(fingerprint, dto.workspaceId);
    if (existing) {
      this.logger.warn(`Idempotent hit: fingerprint ${fingerprint} already executed`);
      return {
        success: true,
        campaignName: existing.afterValue?.campaignName || 'Already created',
        amazonCampaignId: existing.afterValue?.amazonCampaignId,
        dbCampaignId: existing.afterValue?.dbCampaignId,
        fingerprint,
        message: 'Campagne déjà créée — pas de doublon.',
        alreadyCreated: true,
        existingCampaignLink: existing.afterValue?.dbCampaignId
          ? `/campaigns/${existing.afterValue.dbCampaignId}`
          : undefined,
      };
    }

    // 4. Check for pending lock (double-click prevention)
    if (this.isLocked(fingerprint)) {
      throw new ConflictException(
        'Une création est déjà en cours pour cette campagne. Patientez quelques secondes.',
      );
    }

    // 5. Check for duplicate campaigns (same targeting + same seeds)
    await this.checkDuplicateCampaigns(dto);

    // 6. Acquire lock
    this.acquireLock(fingerprint);

    // Compensation log for transactional rollback tracking
    const compensation: CompensationEntry[] = [];

    try {
      // 7. Load book + marketplace profile
      const { book, profile, adAccount } = await this.loadBookContext(dto.bookId);
      const campaignName = this.generateCampaignName(book, dto.planPayload);

      // 8. Create campaign on Amazon Ads API with error handling
      const client = await this.createApiClientSafe(adAccount, profile);

      let amazonCampaignId: number;
      let amazonAdGroupId: number;
      let keywordsCreated = 0;

      // ── Step A: Create Campaign ──
      try {
        const campaignPayload = this.buildAmazonCampaignPayload(campaignName, dto.planPayload);
        const campaignResponse = await this.callAmazonApi(
          client, 'POST', '/sp/campaigns', campaignPayload, 'create_campaign',
        );
        amazonCampaignId = this.extractCampaignId(campaignResponse);
        compensation.push({ step: 'campaign', amazonId: amazonCampaignId, status: 'created' });
      } catch (err: any) {
        const apiErr = this.classifyAmazonError(err);
        await this.logAction(dto, fingerprint, undefined, undefined, campaignName, 'failed', apiErr.message, compensation);
        throw this.buildUserFacingError(apiErr, 'campagne');
      }

      // ── Step B: Create Ad Group ──
      try {
        const adGroupPayload = this.buildAmazonAdGroupPayload(amazonCampaignId, campaignName, dto);
        const agResponse = await this.callAmazonApi(
          client, 'POST', '/sp/adGroups', adGroupPayload, 'create_ad_group',
        );
        amazonAdGroupId = this.extractAdGroupId(agResponse);
        compensation.push({ step: 'ad_group', amazonId: amazonAdGroupId, status: 'created' });
      } catch (err: any) {
        const apiErr = this.classifyAmazonError(err);
        // Campaign was created but ad group failed → compensation log
        compensation.push({ step: 'ad_group', status: 'failed', error: apiErr.message });
        await this.logAction(
          dto, fingerprint, amazonCampaignId, undefined, campaignName,
          'failed', `Ad Group échoué après création campagne: ${apiErr.message}`,
          compensation,
        );
        throw new BadRequestException(
          `La campagne a été créée sur Amazon (ID: ${amazonCampaignId}) mais le groupe d'annonces a échoué. ` +
          `Veuillez créer le groupe manuellement ou relancer. Erreur : ${apiErr.message}`,
        );
      }

      // ── Step C: Create Keywords (manual targeting only) ──
      if (dto.planPayload.targetingType === 'manual' && dto.planPayload.keywords?.length) {
        try {
          const kwPayload = this.buildAmazonKeywordsPayload(
            amazonCampaignId,
            amazonAdGroupId,
            dto.planPayload.keywords,
            dto.planPayload.matchTypes || ['exact'],
            dto.planPayload.dailyBudget || 10,
          );
          await this.callAmazonApi(client, 'POST', '/sp/keywords', kwPayload, 'create_keywords');
          keywordsCreated = dto.planPayload.keywords.length * (dto.planPayload.matchTypes?.length || 1);
          compensation.push({ step: 'keywords', status: 'created' });
        } catch (err: any) {
          const apiErr = this.classifyAmazonError(err);
          // Keywords failed but campaign + ad group exist → warn, don't abort
          compensation.push({ step: 'keywords', status: 'failed', error: apiErr.message });
          this.logger.warn(
            `Keywords creation failed for campaign ${amazonCampaignId}: ${apiErr.message}. ` +
            `Campaign and ad group were created successfully.`,
          );
          // We continue — campaign is usable even without keywords
        }
      }

      // 9. Save to DB
      const dbCampaignId = await this.saveToDatabase(
        profile.id,
        amazonCampaignId,
        amazonAdGroupId,
        campaignName,
        dto,
      );
      compensation.push({ step: 'db_save', dbId: dbCampaignId, status: 'created' });

      // 10. Map campaign to book
      await this.db.insert(campaignBookMapping).values({
        bookId: dto.bookId,
        campaignId: dbCampaignId,
        isPrimary: false,
        notes: `Created from plan: ${dto.planActionType}`,
      }).onConflictDoNothing();

      // 11. Log success
      await this.logAction(dto, fingerprint, amazonCampaignId, dbCampaignId, campaignName, 'success', undefined, compensation);

      const kwWarning = compensation.find(c => c.step === 'keywords' && c.status === 'failed');
      const message = kwWarning
        ? `Campagne créée avec succès, mais les mots-clés n'ont pas pu être ajoutés. Ajoutez-les manuellement.`
        : 'Campagne créée avec succès';

      return {
        success: true,
        campaignName,
        amazonCampaignId,
        amazonAdGroupId,
        dbCampaignId,
        keywordsCreated,
        fingerprint,
        message,
      };
    } catch (err: any) {
      // If already a NestJS HTTP exception, rethrow as-is
      if (err?.status) throw err;

      // Generic fallback
      await this.logAction(dto, fingerprint, undefined, undefined, 'unknown', 'failed', err.message, compensation);
      throw new BadRequestException(
        `Échec de création sur Amazon Ads : ${err.message}`,
      );
    } finally {
      // Always release lock
      this.releaseLock(fingerprint);
    }
  }

  // ── Batch Entry Point ────────────────────────────────────────

  async createBatchFromPlan(dto: BatchCreateFromPlanDto): Promise<BatchCreateFromPlanResult> {
    if (!dto.workspaceId) throw new BadRequestException('workspaceId requis');
    if (!dto.bookId) throw new BadRequestException('bookId requis');
    if (!dto.planId) throw new BadRequestException('planId requis');
    if (!dto.campaigns || dto.campaigns.length === 0) throw new BadRequestException('Aucune campagne dans le plan');
    if (dto.campaigns.length > 10) throw new BadRequestException('Maximum 10 campagnes par batch');

    // Check plan-level idempotence
    const planFingerprint = `plan:${dto.planId}:${dto.fingerprint}`;
    if (this.isLocked(planFingerprint)) {
      throw new ConflictException('Une création batch est déjà en cours pour ce plan. Patientez.');
    }

    const existingPlan = await this.checkIdempotence(planFingerprint, dto.workspaceId);
    if (existingPlan) {
      this.logger.warn(`Batch idempotent hit: plan ${dto.planId} already executed`);
      return {
        planId: dto.planId,
        fingerprint: dto.fingerprint,
        totalRequested: dto.campaigns.length,
        totalCreated: 0,
        totalSkipped: dto.campaigns.length,
        totalFailed: 0,
        results: dto.campaigns.map((c, i) => ({
          index: i,
          name: c.name,
          success: true,
          message: 'Déjà créé précédemment',
          alreadyCreated: true,
        })),
        message: 'Ce plan a déjà été exécuté — aucun doublon créé.',
      };
    }

    this.acquireLock(planFingerprint);

    const results: BatchCampaignResult[] = [];
    let totalCreated = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    try {
      // Apply overrides
      const overridesMap = new Map<number, BatchCampaignOverride>();
      if (dto.overrides) {
        for (const ov of dto.overrides) {
          overridesMap.set(ov.index, ov);
        }
      }

      // Create campaigns sequentially (Amazon rate limits)
      for (let i = 0; i < dto.campaigns.length; i++) {
        const campaign = dto.campaigns[i];
        const override = overridesMap.get(i);

        // Skip if user opted out
        if (override?.skip) {
          results.push({
            index: i,
            name: campaign.name,
            success: true,
            message: 'Ignorée par l\'utilisateur',
            skipped: true,
          });
          totalSkipped++;
          continue;
        }

        // Apply overrides
        const effectiveBudget = override?.dailyBudget ?? campaign.dailyBudget;
        const effectiveKeywords = override?.seedKeywords ?? campaign.seedKeywords;

        // Map CampaignToCreate types to CreateFromPlanDto
        const matchTypes = this.typeToMatchTypes(campaign.type);
        const targetingType = campaign.targetingMode === 'AUTO' ? 'auto' : 'manual';

        const planPayload: any = {
          campaignType: campaign.type?.startsWith('SB') ? 'sponsoredBrands' : 'sponsoredProducts',
          targetingType,
          matchTypes,
          dailyBudget: effectiveBudget,
          keywords: effectiveKeywords || [],
          asins: campaign.seedAsins || [],
          negativeKeywords: campaign.negativeKeywords || [],
        };

        // Inject strategic bid and strategy if provided
        if (campaign.defaultBid) {
          planPayload._defaultBid = campaign.defaultBid;
        }
        if (campaign.biddingStrategy) {
          planPayload._biddingStrategy = campaign.biddingStrategy;
        }
        if (campaign.placementAdjustments) {
          planPayload._placementAdjustments = campaign.placementAdjustments;
        }

        const singleDto: CreateFromPlanDto = {
          workspaceId: dto.workspaceId,
          bookId: dto.bookId,
          planActionType: 'create_campaign',
          planPayload,
          lifecyclePhase: dto.lifecyclePhase,
        };

        try {
          const result = await this.createCampaignFromPlan(singleDto);
          results.push({
            index: i,
            name: result.campaignName,
            success: true,
            amazonCampaignId: result.amazonCampaignId,
            dbCampaignId: result.dbCampaignId,
            message: result.message,
            alreadyCreated: result.alreadyCreated,
          });
          if (result.alreadyCreated) {
            totalSkipped++;
          } else {
            totalCreated++;
          }
        } catch (err: any) {
          const msg = err?.response?.message || err?.message || 'Erreur inconnue';
          results.push({
            index: i,
            name: campaign.name,
            success: false,
            message: msg,
          });
          totalFailed++;

          // On 401/403 (token expired), stop the batch — no point retrying others
          if (msg.includes('Authentification') || msg.includes('401') || msg.includes('403')) {
            // Mark remaining as skipped
            for (let j = i + 1; j < dto.campaigns.length; j++) {
              results.push({
                index: j,
                name: dto.campaigns[j].name,
                success: false,
                message: 'Annulé — authentification expirée',
                skipped: true,
              });
              totalFailed++;
            }
            break;
          }
        }
      }

      // Log batch action
      await this.logBatchAction(dto, planFingerprint, results, totalCreated > 0 ? 'success' : 'failed');

      const allOk = totalFailed === 0;
      const message = allOk
        ? `${totalCreated} campagne(s) créée(s) avec succès.`
        : totalCreated > 0
          ? `${totalCreated} créée(s), ${totalFailed} échouée(s). Vérifiez les détails.`
          : `Aucune campagne créée — ${totalFailed} erreur(s).`;

      return {
        planId: dto.planId,
        fingerprint: dto.fingerprint,
        totalRequested: dto.campaigns.length,
        totalCreated,
        totalSkipped,
        totalFailed,
        results,
        message,
      };
    } finally {
      this.releaseLock(planFingerprint);
    }
  }

  private typeToMatchTypes(type: string): string[] {
    switch (type) {
      case 'SP_MANUAL_EXACT': return ['exact'];
      case 'SP_MANUAL_PHRASE': return ['phrase'];
      case 'SP_MANUAL_BROAD': return ['broad'];
      case 'SP_PRODUCT':
      case 'SP_CATEGORY': return [];
      case 'SP_AUTO': return [];
      default: return [];
    }
  }

  private async logBatchAction(
    dto: BatchCreateFromPlanDto,
    planFingerprint: string,
    results: BatchCampaignResult[],
    status: 'success' | 'failed',
  ): Promise<void> {
    try {
      await this.db.insert(actionLog).values({
        workspaceId: dto.workspaceId,
        entityType: 'campaign',
        entityKey: `fingerprint:${planFingerprint}`,
        amazonEntityId: null,
        actionType: 'create_from_plan',
        beforeValue: null,
        afterValue: {
          planId: dto.planId,
          fingerprint: dto.fingerprint,
          results,
        },
        rationale: `Batch Plan: ${dto.planId}`,
        executedBy: 'user',
        status,
        apiRequest: dto,
        errorMessage: null,
        isReversible: false,
        dryRun: false,
      });
    } catch (err) {
      this.logger.error('Failed to log batch action', err);
    }
  }

  // ── Validation ────────────────────────────────────────────────

  private validate(dto: CreateFromPlanDto): void {
    if (!dto.workspaceId) throw new BadRequestException('workspaceId requis');
    if (!dto.bookId) throw new BadRequestException('bookId requis');
    if (!dto.planActionType) throw new BadRequestException('planActionType requis');
    if (!dto.planPayload) throw new BadRequestException('planPayload requis');

    const budget = dto.planPayload.dailyBudget;
    if (budget !== undefined && (budget < BUDGET_GUARDS.absoluteMin || budget > BUDGET_GUARDS.absoluteMax)) {
      throw new BadRequestException(
        `Le budget journalier doit être entre ${BUDGET_GUARDS.absoluteMin}€ et ${BUDGET_GUARDS.absoluteMax}€`,
      );
    }

    // Validate keywords: trim, lowercase, dedup
    if (dto.planPayload.keywords?.length) {
      dto.planPayload.keywords = [...new Set(
        dto.planPayload.keywords
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean),
      )];
    }

    // Validate ASINs
    if (dto.planPayload.asins?.length) {
      dto.planPayload.asins = [...new Set(
        dto.planPayload.asins
          .map((a) => a.trim().toUpperCase())
          .filter(Boolean),
      )];
    }

    // Validate match types
    const validMatchTypes = ['exact', 'phrase', 'broad'];
    if (dto.planPayload.matchTypes?.length) {
      for (const mt of dto.planPayload.matchTypes) {
        if (!validMatchTypes.includes(mt)) {
          throw new BadRequestException(`Type de correspondance invalide: ${mt}`);
        }
      }
    }
  }

  // ── Lifecycle Defaults ────────────────────────────────────────

  private applyLifecycleDefaults(dto: CreateFromPlanDto): void {
    const lifecycle = (dto.lifecyclePhase || 'launch') as keyof typeof LIFECYCLE_DEFAULTS;
    const defaults = LIFECYCLE_DEFAULTS[lifecycle] || LIFECYCLE_DEFAULTS.launch;
    const payload = dto.planPayload;

    const targetingType = payload.targetingType || 'auto';
    const key = targetingType === 'auto' ? 'auto' : 'manual';

    // Apply default budget if not provided
    if (!payload.dailyBudget) {
      payload.dailyBudget = defaults[key].dailyBudget;
    }

    // Apply default bidding strategy (stored for payload building)
    if (!(payload as any)._biddingStrategy) {
      (payload as any)._biddingStrategy = defaults[key].biddingStrategy;
    }

    // Apply default bid
    if (!(payload as any)._defaultBid) {
      (payload as any)._defaultBid = defaults[key].defaultBid;
    }

    // Apply default match types for manual if not provided
    if (targetingType === 'manual' && (!payload.matchTypes || payload.matchTypes.length === 0)) {
      payload.matchTypes = defaults.manual.defaultMatchTypes;
    }
  }

  // ── Guards (budget, bid, duplicate prevention) ─────────────

  private applyGuards(dto: CreateFromPlanDto): void {
    const lifecycle = (dto.lifecyclePhase || 'launch') as keyof typeof LIFECYCLE_DEFAULTS;
    const defaults = LIFECYCLE_DEFAULTS[lifecycle] || LIFECYCLE_DEFAULTS.launch;
    const payload = dto.planPayload;

    // Budget guard per lifecycle
    const maxBudget = defaults.maxDailyBudget;
    if (payload.dailyBudget && payload.dailyBudget > maxBudget) {
      this.logger.warn(
        `Budget ${payload.dailyBudget}€ exceeds lifecycle ${lifecycle} max ${maxBudget}€ — capping`,
      );
      payload.dailyBudget = maxBudget;
    }

    // Bid guards (global)
    const bid = (payload as any)._defaultBid;
    if (bid !== undefined) {
      if (bid < BID_GUARDS.absoluteMin) (payload as any)._defaultBid = BID_GUARDS.absoluteMin;
      if (bid > BID_GUARDS.absoluteMax) (payload as any)._defaultBid = BID_GUARDS.absoluteMax;
    }
  }

  // ── Duplicate Campaign Check ──────────────────────────────────

  private async checkDuplicateCampaigns(dto: CreateFromPlanDto): Promise<void> {
    // Check if a campaign with the same targeting + same seed keywords already exists for this book
    const mappings = await this.db
      .select({ campaignId: campaignBookMapping.campaignId })
      .from(campaignBookMapping)
      .where(eq(campaignBookMapping.bookId, dto.bookId));

    if (mappings.length === 0) return;

    const campaignIds = mappings.map((m: any) => m.campaignId);
    const existingCampaigns = await this.db
      .select()
      .from(campaigns)
      .where(
        and(
          inArray(campaigns.id, campaignIds),
          eq(campaigns.state, 'enabled'),
        ),
      );

    const targetingType = dto.planPayload.targetingType || 'auto';

    for (const existing of existingCampaigns) {
      if (existing.targetingType === targetingType) {
        // For manual targeting, also check keywords overlap
        if (targetingType === 'manual' && dto.planPayload.keywords?.length) {
          const existingKws = await this.db
            .select({ keywordText: keywords.keywordText })
            .from(keywords)
            .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
            .where(eq(adGroups.campaignId, existing.id));

          const existingTexts = new Set(existingKws.map((k: any) => k.keywordText?.toLowerCase()));
          const newTexts = dto.planPayload.keywords.map((k) => k.toLowerCase());
          const overlap = newTexts.filter((t) => existingTexts.has(t));

          if (overlap.length > 0 && overlap.length >= newTexts.length * 0.8) {
            throw new ConflictException(
              `Une campagne similaire existe déjà (${existing.name}). ` +
              `${overlap.length}/${newTexts.length} mots-clés sont en commun. ` +
              `Modifiez vos mots-clés ou vérifiez la campagne existante.`,
            );
          }
        } else if (targetingType === 'auto') {
          // Two auto campaigns for the same book → warn
          throw new ConflictException(
            `Une campagne Auto existe déjà pour ce livre (${existing.name}). ` +
            `Créer une seconde campagne Auto va provoquer de la cannibalisation.`,
          );
        }
      }
    }
  }

  // ── Idempotence ───────────────────────────────────────────────

  private computeFingerprint(dto: CreateFromPlanDto): string {
    const data = JSON.stringify({
      workspaceId: dto.workspaceId,
      bookId: dto.bookId,
      lifecyclePhase: dto.lifecyclePhase || 'launch',
      planActionType: dto.planActionType,
      campaignType: dto.planPayload.campaignType || 'sponsoredProducts',
      targetingType: dto.planPayload.targetingType || 'auto',
      matchTypes: (dto.planPayload.matchTypes || []).slice().sort(),
      keywords: (dto.planPayload.keywords || []).map((k) => k.trim().toLowerCase()).sort(),
      asins: (dto.planPayload.asins || []).map((a) => a.trim().toUpperCase()).sort(),
      strategicPeriodDays: dto.strategicPeriodDays || 30,
    });
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  private async checkIdempotence(fingerprint: string, workspaceId: string): Promise<any | null> {
    const ttlDate = new Date();
    ttlDate.setDate(ttlDate.getDate() - IDEMPOTENCE_TTL_DAYS);

    const [existing] = await this.db
      .select()
      .from(actionLog)
      .where(
        and(
          eq(actionLog.workspaceId, workspaceId),
          eq(actionLog.actionType, 'create_from_plan'),
          eq(actionLog.status, 'success'),
          eq(actionLog.entityKey, `fingerprint:${fingerprint}`),
          gte(actionLog.executedAt, ttlDate),
        ),
      )
      .limit(1);

    return existing || null;
  }

  // ── Lock management ───────────────────────────────────────────

  private isLocked(fingerprint: string): boolean {
    const ts = this.pendingLocks.get(fingerprint);
    if (!ts) return false;
    // Auto-expire stale locks
    if (Date.now() - ts > LOCK_TIMEOUT_MS) {
      this.pendingLocks.delete(fingerprint);
      return false;
    }
    return true;
  }

  private acquireLock(fingerprint: string): void {
    this.pendingLocks.set(fingerprint, Date.now());
  }

  private releaseLock(fingerprint: string): void {
    this.pendingLocks.delete(fingerprint);
  }

  // ── Amazon API with error classification ──────────────────────

  private async createApiClientSafe(adAccount: any, profile: any) {
    try {
      return await this.amazonClient.createApiClient(
        adAccount.id,
        Number(profile.amazonProfileId),
        profile.marketplace as any,
      );
    } catch (err: any) {
      throw new BadRequestException(
        `Impossible de se connecter à Amazon Ads. Vérifiez que votre compte est bien lié. ` +
        `Erreur : ${err.message}`,
      );
    }
  }

  private async callAmazonApi(
    client: any,
    method: 'POST' | 'GET',
    path: string,
    payload: any,
    stepName: string,
  ): Promise<any> {
    try {
      const response = method === 'POST'
        ? await client.post(path, payload)
        : await client.get(path);
      return response.data;
    } catch (err: any) {
      const apiErr = this.classifyAmazonError(err);
      this.logger.error(`Amazon API error at ${stepName} (${path}): ${apiErr.code} — ${apiErr.message}`);
      throw err; // Re-throw, caller handles classification
    }
  }

  private classifyAmazonError(err: any): AmazonApiError {
    const status = err?.response?.status || err?.status;
    const message = err?.response?.data?.message || err?.response?.data?.details || err?.message || 'Erreur inconnue';

    if (status === 401 || status === 403) {
      return {
        code: 'TOKEN_EXPIRED',
        message: `Authentification expirée (${status}). Reconnectez votre compte Amazon Ads.`,
        retryable: false,
        statusCode: status,
      };
    }

    if (status === 429) {
      return {
        code: 'RATE_LIMITED',
        message: 'Amazon Ads est temporairement surchargé (rate limit). Réessayez dans quelques minutes.',
        retryable: true,
        statusCode: 429,
      };
    }

    if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || message.includes('timeout')) {
      return {
        code: 'TIMEOUT',
        message: 'La requête Amazon Ads a expiré. Réessayez dans quelques instants.',
        retryable: true,
      };
    }

    return {
      code: 'UNKNOWN',
      message: `Erreur Amazon Ads : ${message}`,
      retryable: false,
      statusCode: status,
    };
  }

  private buildUserFacingError(apiErr: AmazonApiError, stepLabel: string): BadRequestException {
    const retryHint = apiErr.retryable ? ' Vous pouvez réessayer.' : '';
    return new BadRequestException(
      `Échec de création de la ${stepLabel} : ${apiErr.message}${retryHint}`,
    );
  }

  // ── Data Loading ──────────────────────────────────────────────

  private async loadBookContext(bookId: string) {
    const [book] = await this.db.select().from(books).where(eq(books.id, bookId)).limit(1);
    if (!book) throw new BadRequestException(`Livre ${bookId} non trouvé`);

    const mappings = await this.db
      .select({ campaignId: campaignBookMapping.campaignId })
      .from(campaignBookMapping)
      .where(eq(campaignBookMapping.bookId, bookId));

    let profile: any;
    let adAccount: any;

    if (mappings.length > 0) {
      const [existingCampaign] = await this.db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, mappings[0].campaignId))
        .limit(1);

      if (existingCampaign) {
        [profile] = await this.db
          .select()
          .from(marketplaceProfiles)
          .where(eq(marketplaceProfiles.id, existingCampaign.profileId))
          .limit(1);
      }
    }

    if (!profile) {
      const workspace = book.workspaceId;
      const accounts = await this.db
        .select()
        .from(adAccounts)
        .where(eq(adAccounts.workspaceId, workspace))
        .limit(1);

      if (accounts.length === 0) throw new BadRequestException('Aucun compte Amazon Ads trouvé pour ce workspace');

      [profile] = await this.db
        .select()
        .from(marketplaceProfiles)
        .where(eq(marketplaceProfiles.adAccountId, accounts[0].id))
        .limit(1);

      adAccount = accounts[0];
    }

    if (!profile) throw new BadRequestException('Aucun profil marketplace trouvé');

    if (!adAccount) {
      [adAccount] = await this.db
        .select()
        .from(adAccounts)
        .where(eq(adAccounts.id, profile.adAccountId))
        .limit(1);
    }

    if (!adAccount) throw new BadRequestException('Compte Ad non trouvé');

    return { book, profile, adAccount };
  }

  // ── Name Generation ───────────────────────────────────────────

  private generateCampaignName(book: any, payload: CreateFromPlanDto['planPayload']): string {
    const bookTitle = (book.title || book.asin || 'Book').slice(0, 30);
    const tt = payload.targetingType === 'auto'
      ? 'Auto'
      : (payload.matchTypes || ['Manual']).map((m: string) => m.charAt(0).toUpperCase() + m.slice(1)).join('-');
    const ct = payload.campaignType === 'sponsoredBrands' ? 'SB' : payload.campaignType === 'sponsoredDisplay' ? 'SD' : 'SP';

    return `${bookTitle}-${ct}-${tt}`.replace(/\s+/g, '-');
  }

  // ── Amazon API Payloads ───────────────────────────────────────

  private buildAmazonCampaignPayload(name: string, payload: CreateFromPlanDto['planPayload']): any {
    const biddingStrategy = (payload as any)._biddingStrategy || 'LEGACY_FOR_SALES';

    return {
      campaigns: [
        {
          name,
          campaignType: 'SPONSORED_PRODUCTS',
          targetingType: payload.targetingType === 'auto' ? 'AUTO' : 'MANUAL',
          state: 'ENABLED',
          budget: {
            budgetType: 'DAILY',
            budget: payload.dailyBudget || 10,
          },
          dynamicBidding: {
            strategy: biddingStrategy,
          },
          startDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        },
      ],
    };
  }

  private buildAmazonAdGroupPayload(
    campaignId: number,
    campaignName: string,
    dto: CreateFromPlanDto,
  ): any {
    const defaultBid = (dto.planPayload as any)._defaultBid
      || Math.min(dto.planPayload.dailyBudget ? dto.planPayload.dailyBudget * 0.05 : 0.5, 2.0);

    // Clamp bid within guards
    const clampedBid = Math.max(
      BID_GUARDS.absoluteMin,
      Math.min(defaultBid, BID_GUARDS.absoluteMax),
    );

    return {
      adGroups: [
        {
          campaignId,
          name: `${campaignName}-AG1`,
          state: 'ENABLED',
          defaultBid: clampedBid,
        },
      ],
    };
  }

  private buildAmazonKeywordsPayload(
    campaignId: number,
    adGroupId: number,
    kwTexts: string[],
    matchTypes: string[],
    dailyBudget: number,
  ): any {
    const baseBid = (this as any)._currentDefaultBid || Math.min(dailyBudget * 0.05, 2.0);
    const clampedBid = Math.max(BID_GUARDS.absoluteMin, Math.min(baseBid, BID_GUARDS.absoluteMax));
    const kws: any[] = [];

    for (const text of kwTexts) {
      for (const mt of matchTypes) {
        kws.push({
          campaignId,
          adGroupId,
          keywordText: text.trim().toLowerCase(),
          matchType: mt.toUpperCase(),
          state: 'ENABLED',
          bid: clampedBid,
        });
      }
    }

    return { keywords: kws };
  }

  // ── Response Extractors ───────────────────────────────────────

  private extractCampaignId(data: any): number {
    if (data?.campaigns?.success?.[0]?.campaignId) {
      return data.campaigns.success[0].campaignId;
    }
    if (data?.campaignId) {
      return data.campaignId;
    }
    const first = Array.isArray(data) ? data[0] : data;
    if (first?.campaignId) return first.campaignId;

    throw new Error(`Réponse Amazon inattendue (campaign): ${JSON.stringify(data).slice(0, 200)}`);
  }

  private extractAdGroupId(data: any): number {
    if (data?.adGroups?.success?.[0]?.adGroupId) {
      return data.adGroups.success[0].adGroupId;
    }
    if (data?.adGroupId) {
      return data.adGroupId;
    }
    const first = Array.isArray(data) ? data[0] : data;
    if (first?.adGroupId) return first.adGroupId;

    throw new Error(`Réponse Amazon inattendue (ad group): ${JSON.stringify(data).slice(0, 200)}`);
  }

  // ── DB Save ───────────────────────────────────────────────────

  private async saveToDatabase(
    profileId: string,
    amazonCampaignId: number,
    amazonAdGroupId: number,
    campaignName: string,
    dto: CreateFromPlanDto,
  ): Promise<string> {
    const [newCampaign] = await this.db
      .insert(campaigns)
      .values({
        profileId,
        amazonCampaignId,
        name: campaignName,
        campaignType: dto.planPayload.campaignType || 'sponsoredProducts',
        state: 'enabled',
        targetingType: dto.planPayload.targetingType || 'auto',
        dailyBudget: String(dto.planPayload.dailyBudget || 10),
        lastSyncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    if (!newCampaign) throw new Error('Failed to insert campaign in DB');

    const defaultBid = (dto.planPayload as any)._defaultBid
      || Math.min((dto.planPayload.dailyBudget || 10) * 0.05, 2.0);

    const [newAdGroup] = await this.db
      .insert(adGroups)
      .values({
        campaignId: newCampaign.id,
        amazonAdGroupId,
        name: `${campaignName}-AG1`,
        state: 'enabled',
        defaultBid: String(Math.max(BID_GUARDS.absoluteMin, Math.min(defaultBid, BID_GUARDS.absoluteMax))),
        lastSyncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    if (newAdGroup && dto.planPayload.targetingType === 'manual' && dto.planPayload.keywords?.length) {
      const matchTypes = dto.planPayload.matchTypes || ['exact'];
      const bid = Math.max(BID_GUARDS.absoluteMin, Math.min(defaultBid, BID_GUARDS.absoluteMax));
      const kwValues = dto.planPayload.keywords.flatMap((text) =>
        matchTypes.map((mt) => ({
          adGroupId: newAdGroup.id,
          amazonKeywordId: 0,
          keywordText: text.trim().toLowerCase(),
          matchType: mt.toLowerCase(),
          state: 'enabled',
          bid: String(bid),
          lastSyncedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );

      if (kwValues.length > 0) {
        await this.db.insert(keywords).values(kwValues).onConflictDoNothing();
      }
    }

    return newCampaign.id;
  }

  // ── Action Logging (with compensation) ────────────────────────

  private async logAction(
    dto: CreateFromPlanDto,
    fingerprint: string,
    amazonCampaignId: number | undefined,
    dbCampaignId: string | undefined,
    campaignName: string,
    status: 'success' | 'failed',
    errorMessage?: string,
    compensation?: CompensationEntry[],
  ): Promise<void> {
    try {
      await this.db.insert(actionLog).values({
        workspaceId: dto.workspaceId,
        entityType: 'campaign',
        entityKey: `fingerprint:${fingerprint}`,
        amazonEntityId: amazonCampaignId || null,
        actionType: 'create_from_plan',
        beforeValue: null,
        afterValue: {
          campaignName,
          amazonCampaignId,
          dbCampaignId,
          planActionType: dto.planActionType,
          planPayload: dto.planPayload,
          fingerprint,
          compensation: compensation || [],
        },
        rationale: `Plan Evolution: ${dto.planActionType}`,
        executedBy: 'user',
        status,
        apiRequest: dto.planPayload,
        errorMessage: errorMessage || null,
        isReversible: false,
        dryRun: false,
      });
    } catch (err) {
      this.logger.error('Failed to log action', err);
    }
  }

  // ── Pause Batch ──────────────────────────────────────────────

  async pauseBatch(dto: PauseBatchDto): Promise<PauseBatchResult> {
    this.logger.log(`[PAUSE-BATCH] Pausing ${dto.campaignIds.length} campaigns for book ${dto.bookId}`);

    const results: PauseBatchResult['results'] = [];
    let totalPaused = 0;
    let totalFailed = 0;

    // Load campaign details to get Amazon IDs
    const dbCampaigns = await this.db
      .select()
      .from(campaigns)
      .where(inArray(campaigns.id, dto.campaignIds));

    const campaignMap = new Map<string, any>();
    for (const c of dbCampaigns) {
      campaignMap.set(c.id, c);
    }

    // Load workspace profile info: adAccount → profile (marketplaceProfiles has no workspaceId)
    const [adAccount] = await this.db
      .select()
      .from(adAccounts)
      .where(eq(adAccounts.workspaceId, dto.workspaceId))
      .limit(1);

    if (!adAccount) {
      throw new BadRequestException('No ad account found for workspace');
    }

    const [profile] = await this.db
      .select()
      .from(marketplaceProfiles)
      .where(eq(marketplaceProfiles.adAccountId, adAccount.id))
      .limit(1);

    if (!profile) {
      throw new BadRequestException('No marketplace profile found for workspace');
    }

    for (const campaignId of dto.campaignIds) {
      const campaign = campaignMap.get(campaignId);
      if (!campaign) {
        results.push({
          campaignId,
          campaignName: 'Unknown',
          success: false,
          message: 'Campaign not found in database',
        });
        totalFailed++;
        continue;
      }

      try {
        const amazonCampaignId = campaign.amazonCampaignId;
        if (!amazonCampaignId) {
          results.push({
            campaignId,
            campaignName: campaign.name,
            success: false,
            message: 'No Amazon campaign ID',
          });
          totalFailed++;
          continue;
        }

        const result = await this.amazonClient.updateCampaignState(
          adAccount.id,
          profile.profileId,
          profile.marketplace,
          Number(amazonCampaignId),
          'paused',
        );

        if (result.success) {
          // Update local state
          await this.db.update(campaigns)
            .set({ state: 'paused', updatedAt: new Date() })
            .where(eq(campaigns.id, campaignId));

          results.push({
            campaignId,
            campaignName: campaign.name,
            success: true,
            message: 'Paused',
          });
          totalPaused++;
        } else {
          results.push({
            campaignId,
            campaignName: campaign.name,
            success: false,
            message: result.error || 'Amazon API error',
          });
          totalFailed++;
        }

        // Cooldown between API calls
        if (dto.campaignIds.indexOf(campaignId) < dto.campaignIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, PAUSE_BATCH_CONFIG.cooldownMs));
        }
      } catch (err: any) {
        results.push({
          campaignId,
          campaignName: campaign.name,
          success: false,
          message: err.message || 'Unexpected error',
        });
        totalFailed++;
      }
    }

    // Log action
    try {
      await this.db.insert(actionLog).values({
        entityType: 'book',
        entityId: dto.bookId,
        actionType: 'pause_batch',
        payload: {
          campaignIds: dto.campaignIds,
          reason: dto.reason,
          totalPaused,
          totalFailed,
        },
        rationale: `Pause batch: ${dto.reason}`,
        executedBy: 'user',
        status: totalFailed === 0 ? 'completed' : 'partial',
        apiRequest: dto,
        errorMessage: totalFailed > 0 ? `${totalFailed} failed` : null,
        isReversible: true,
        dryRun: false,
      });
    } catch (err) {
      this.logger.error('Failed to log pause action', err);
    }

    return {
      totalRequested: dto.campaignIds.length,
      totalPaused,
      totalFailed,
      results,
    };
  }

  // ── Pause All For Book ──────────────────────────────────────

  async pauseAllForBook(
    workspaceId: string,
    bookId: string,
    reason: string,
  ): Promise<PauseAllForBookResult> {
    this.logger.log(`[PAUSE-ALL] Pausing all active campaigns for book ${bookId}`);

    // 1. Find all campaigns mapped to this book
    const mappings = await this.db
      .select({ campaignId: campaignBookMapping.campaignId })
      .from(campaignBookMapping)
      .where(eq(campaignBookMapping.bookId, bookId));

    if (mappings.length === 0) {
      return {
        totalActive: 0,
        totalPaused: 0,
        totalFailed: 0,
        totalAlreadyPaused: 0,
        totalBudgetSaved: 0,
        failedCampaigns: [],
      };
    }

    const campaignIds = mappings.map((m: any) => m.campaignId);

    // 2. Load all campaigns to check state
    const allCampaigns = await this.db
      .select()
      .from(campaigns)
      .where(inArray(campaigns.id, campaignIds));

    const activeCampaigns = allCampaigns.filter(
      (c: any) => c.state === 'enabled' || c.state === 'active',
    );
    const alreadyPaused = allCampaigns.filter(
      (c: any) => c.state === 'paused',
    );

    if (activeCampaigns.length === 0) {
      return {
        totalActive: 0,
        totalPaused: 0,
        totalFailed: 0,
        totalAlreadyPaused: alreadyPaused.length,
        totalBudgetSaved: 0,
        failedCampaigns: [],
      };
    }

    // 3. Batch pause in chunks of PAUSE_BATCH_CONFIG.maxPerBatch
    const activeCampaignIds = activeCampaigns.map((c: any) => c.id);
    let totalPaused = 0;
    let totalFailed = 0;
    let totalBudgetSaved = 0;
    const failedCampaigns: PauseAllForBookResult['failedCampaigns'] = [];

    for (let i = 0; i < activeCampaignIds.length; i += PAUSE_BATCH_CONFIG.maxPerBatch) {
      const chunk = activeCampaignIds.slice(i, i + PAUSE_BATCH_CONFIG.maxPerBatch);

      try {
        const result = await this.pauseBatch({
          workspaceId,
          bookId,
          campaignIds: chunk,
          reason,
        });

        totalPaused += result.totalPaused;
        totalFailed += result.totalFailed;

        for (const r of result.results) {
          if (!r.success) {
            failedCampaigns.push({
              campaignId: r.campaignId,
              name: r.campaignName,
              error: r.message,
            });
          }
        }
      } catch (err: any) {
        // Entire chunk failed
        totalFailed += chunk.length;
        for (const cId of chunk) {
          const camp = activeCampaigns.find((c: any) => c.id === cId);
          failedCampaigns.push({
            campaignId: cId,
            name: camp?.name || 'Unknown',
            error: err.message || 'Batch pause failed',
          });
        }
      }
    }

    // 4. Compute budget saved
    for (const c of activeCampaigns) {
      const budget = c.dailyBudget ? Number(c.dailyBudget) : 0;
      // Only count if it was actually paused
      const wasFailed = failedCampaigns.some(f => f.campaignId === c.id);
      if (!wasFailed) {
        totalBudgetSaved += budget;
      }
    }

    return {
      totalActive: activeCampaigns.length,
      totalPaused,
      totalFailed,
      totalAlreadyPaused: alreadyPaused.length,
      totalBudgetSaved: Math.round(totalBudgetSaved * 100) / 100,
      failedCampaigns,
    };
  }
}
