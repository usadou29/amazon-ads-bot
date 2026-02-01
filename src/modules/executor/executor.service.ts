import { Injectable, Inject, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE_CONNECTION } from '@/db/database.module';
import {
  recommendations,
  actionLog,
  systemConfig,
  keywords,
  adGroups,
  campaigns,
  marketplaceProfiles,
  adAccounts,
  Recommendation,
  ActionLogEntry,
  NewActionLogEntry,
  KillSwitchConfig,
} from '@/db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { validateBidChange, GUARDS } from '@/config/guards';
import { extractAmazonId } from '@/utils/entity-key';
import { AmazonClientService } from '@/modules/amazon-client';
import { Marketplace } from '@/config/amazon';

// Types d'actions supportees
export const SUPPORTED_ACTIONS = ['adjust_bid', 'pause', 'create_keyword', 'create_negative'] as const;
export type SupportedAction = typeof SUPPORTED_ACTIONS[number];

export interface ExecuteActionOptions {
  recommendationId: string;
  dryRun?: boolean;
  executedBy?: 'system' | 'user' | 'manual';
}

export interface ExecuteActionResult {
  success: boolean;
  actionId?: string;
  error?: string;
  dryRun: boolean;
  beforeValue?: Record<string, any>;
  afterValue?: Record<string, any>;
  apiRequest?: Record<string, any>;
  apiResponse?: Record<string, any>;
}

export interface ExecuteBatchOptions {
  recommendationIds: string[];
  dryRun?: boolean;
  executedBy?: 'system' | 'user' | 'manual';
  stopOnError?: boolean;
}

export interface ExecuteBatchResult {
  total: number;
  executed: number;
  failed: number;
  skipped: number;
  results: Array<{
    recommendationId: string;
    result: ExecuteActionResult;
  }>;
}

export interface ActionLogQuery {
  workspaceId?: string;
  entityType?: string;
  entityKey?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
    private configService: ConfigService,
    private amazonClient: AmazonClientService,
  ) {}

  // ============================================
  // KILL SWITCH
  // ============================================

  /**
   * Verifie si le kill switch est actif
   */
  async isKillSwitchActive(): Promise<{ active: boolean; reason?: string }> {
    // Verifier d'abord la variable d'environnement
    const envKillSwitch = this.configService.get<boolean>('features.killSwitchEnabled');
    if (envKillSwitch) {
      return { active: true, reason: 'Kill switch enabled via environment variable' };
    }

    // Verifier ensuite la config en base
    const [config] = await this.db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, 'kill_switch'))
      .limit(1);

    if (config) {
      const killSwitchConfig = config.value as KillSwitchConfig;
      if (killSwitchConfig.enabled) {
        return {
          active: true,
          reason: killSwitchConfig.reason || 'Kill switch enabled in database',
        };
      }
    }

    return { active: false };
  }

  /**
   * Active le kill switch
   */
  async enableKillSwitch(reason: string, enabledBy: string): Promise<void> {
    const config: KillSwitchConfig = {
      enabled: true,
      reason,
      enabled_at: new Date().toISOString(),
      enabled_by: enabledBy,
    };

    await this.db
      .insert(systemConfig)
      .values({
        key: 'kill_switch',
        value: config,
      })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: {
          value: config,
          updatedAt: new Date(),
        },
      });

    this.logger.warn(`Kill switch ENABLED by ${enabledBy}: ${reason}`);
  }

  /**
   * Desactive le kill switch
   */
  async disableKillSwitch(): Promise<void> {
    const config: KillSwitchConfig = {
      enabled: false,
      reason: null,
      enabled_at: null,
      enabled_by: null,
    };

    await this.db
      .insert(systemConfig)
      .values({
        key: 'kill_switch',
        value: config,
      })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: {
          value: config,
          updatedAt: new Date(),
        },
      });

    this.logger.log('Kill switch DISABLED');
  }

  // ============================================
  // ACTION EXECUTION
  // ============================================

  /**
   * Execute une recommandation approuvee
   */
  async executeAction(options: ExecuteActionOptions): Promise<ExecuteActionResult> {
    const { recommendationId, dryRun = false, executedBy = 'system' } = options;

    this.logger.log(`Executing recommendation ${recommendationId} (dryRun=${dryRun})`);

    // 1. Verifier le kill switch
    const killSwitch = await this.isKillSwitchActive();
    if (killSwitch.active) {
      this.logger.warn(`Execution blocked by kill switch: ${killSwitch.reason}`);
      return {
        success: false,
        error: `Kill switch active: ${killSwitch.reason}`,
        dryRun,
      };
    }

    // 2. Recuperer la recommandation
    const [recommendation] = await this.db
      .select()
      .from(recommendations)
      .where(eq(recommendations.id, recommendationId))
      .limit(1);

    if (!recommendation) {
      throw new NotFoundException(`Recommendation ${recommendationId} not found`);
    }

    // 3. Verifier le statut
    if (recommendation.status !== 'approved' && recommendation.status !== 'pending') {
      return {
        success: false,
        error: `Recommendation status is '${recommendation.status}', expected 'approved' or 'pending'`,
        dryRun,
      };
    }

    // 4. Verifier les limites quotidiennes
    const dailyCheck = await this.checkDailyLimits(recommendation.workspaceId);
    if (!dailyCheck.canExecute) {
      return {
        success: false,
        error: dailyCheck.reason,
        dryRun,
      };
    }

    // 5. Executer l'action
    const suggestedAction = recommendation.suggestedAction as Record<string, any>;
    const actionType = suggestedAction.action_type || recommendation.actionType;

    try {
      const result = await this.executeSpecificAction(
        recommendation,
        actionType as SupportedAction,
        dryRun,
        executedBy,
      );

      // 6. Mettre a jour le statut de la recommandation si execution reelle
      if (!dryRun && result.success) {
        await this.db
          .update(recommendations)
          .set({
            status: 'executed',
            actionId: result.actionId,
          })
          .where(eq(recommendations.id, recommendationId));
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Execution failed for ${recommendationId}: ${errorMessage}`);

      // Logger l'echec
      await this.logAction({
        workspaceId: recommendation.workspaceId,
        recommendationId: recommendation.id,
        ruleId: recommendation.ruleId,
        entityType: recommendation.entityType,
        entityKey: recommendation.entityKey,
        actionType,
        rationale: `Failed: ${errorMessage}`,
        executedBy,
        status: 'failed',
        errorMessage,
        dryRun,
      });

      return {
        success: false,
        error: errorMessage,
        dryRun,
      };
    }
  }

  /**
   * Execute une action specifique
   */
  private async executeSpecificAction(
    recommendation: Recommendation,
    actionType: SupportedAction,
    dryRun: boolean,
    executedBy: string,
  ): Promise<ExecuteActionResult> {
    const suggestedAction = recommendation.suggestedAction as Record<string, any>;

    switch (actionType) {
      case 'adjust_bid':
        return this.executeAdjustBid(recommendation, suggestedAction, dryRun, executedBy);

      case 'pause':
        return this.executePause(recommendation, suggestedAction, dryRun, executedBy);

      case 'create_keyword':
        return this.executeCreateKeyword(recommendation, suggestedAction, dryRun, executedBy);

      case 'create_negative':
        return this.executeCreateNegative(recommendation, suggestedAction, dryRun, executedBy);

      default:
        throw new BadRequestException(`Unsupported action type: ${actionType}`);
    }
  }

  /**
   * Execute un ajustement d'enchere
   * entity_key format: type:amazon_id (ex: keyword:123456789)
   */
  private async executeAdjustBid(
    recommendation: Recommendation,
    suggestedAction: Record<string, any>,
    dryRun: boolean,
    executedBy: string,
  ): Promise<ExecuteActionResult> {
    const amazonKeywordId = extractAmazonId(recommendation.entityKey);
    if (amazonKeywordId === null) {
      throw new BadRequestException(`Invalid entity_key for keyword: ${recommendation.entityKey}`);
    }

    const ctx = await this.getKeywordContextByEntityKey(recommendation.workspaceId, amazonKeywordId);
    if (!ctx) {
      throw new NotFoundException(`Keyword not found for entity ${recommendation.entityKey}`);
    }
    const { keyword } = ctx;

    const currentBid = Number(keyword.bid) || 0;
    let newBid: number;

    // Calculer le nouveau bid
    if (suggestedAction.adjustment_type === 'percentage') {
      const adjustment = Number(suggestedAction.adjustment_value) || 0;
      newBid = currentBid * (1 + adjustment / 100);
    } else {
      newBid = Number(suggestedAction.adjustment_value) || currentBid;
    }

    // Valider le changement
    const validation = validateBidChange(currentBid, newBid);
    if (!validation.valid) {
      this.logger.warn(
        `Bid change validation failed: ${validation.errors.join(', ')}. Adjusting to ${validation.adjustedValue}`,
      );
      newBid = validation.adjustedValue;
    }

    const beforeValue = { bid: currentBid };
    const afterValue = { bid: newBid };
    const apiRequest = {
      keywordId: keyword.amazonKeywordId,
      updates: { bid: newBid },
    };

    let apiResponse: any;

    // Executer si pas en dry run
    if (!dryRun) {
      apiResponse = await this.amazonClient.updateKeyword(
        ctx.adAccountId,
        ctx.profileId,
        ctx.marketplace as Marketplace,
        keyword.amazonKeywordId,
        { bid: newBid },
      );

      // Mettre a jour le keyword en base
      await this.db
        .update(keywords)
        .set({
          bid: String(newBid),
          updatedAt: new Date(),
        })
        .where(eq(keywords.id, keyword.id));
    }

    // Logger l'action
    const actionLogEntry = await this.logAction({
      workspaceId: recommendation.workspaceId,
      recommendationId: recommendation.id,
      ruleId: recommendation.ruleId,
      entityType: recommendation.entityType,
      entityKey: recommendation.entityKey,
      amazonEntityId: keyword.amazonKeywordId,
      actionType: 'adjust_bid',
      beforeValue,
      afterValue,
      rationale: `Bid ${currentBid > newBid ? 'decreased' : 'increased'} from ${currentBid} to ${newBid}`,
      executedBy,
      status: dryRun ? 'simulated' : 'success',
      apiRequest,
      apiResponse,
      isReversible: true,
      dryRun,
    });

    return {
      success: true,
      actionId: actionLogEntry.id,
      dryRun,
      beforeValue,
      afterValue,
      apiRequest,
      apiResponse,
    };
  }

  /**
   * Execute une pause de keyword
   * entity_key format: type:amazon_id (ex: keyword:123456789)
   */
  private async executePause(
    recommendation: Recommendation,
    suggestedAction: Record<string, any>,
    dryRun: boolean,
    executedBy: string,
  ): Promise<ExecuteActionResult> {
    const amazonKeywordId = extractAmazonId(recommendation.entityKey);
    if (amazonKeywordId === null) {
      throw new BadRequestException(`Invalid entity_key for keyword: ${recommendation.entityKey}`);
    }

    const ctx = await this.getKeywordContextByEntityKey(recommendation.workspaceId, amazonKeywordId);
    if (!ctx) {
      throw new NotFoundException(`Keyword not found for entity ${recommendation.entityKey}`);
    }
    const { keyword } = ctx;

    const beforeValue = { state: keyword.state };
    const afterValue = { state: 'paused' };
    const apiRequest = {
      keywordId: keyword.amazonKeywordId,
      updates: { state: 'paused' },
    };

    let apiResponse: any;

    // Executer si pas en dry run
    if (!dryRun) {
      apiResponse = await this.amazonClient.updateKeyword(
        ctx.adAccountId,
        ctx.profileId,
        ctx.marketplace as Marketplace,
        keyword.amazonKeywordId,
        { state: 'paused' },
      );

      // Mettre a jour le keyword en base
      await this.db
        .update(keywords)
        .set({
          state: 'paused',
          updatedAt: new Date(),
        })
        .where(eq(keywords.id, keyword.id));
    }

    // Logger l'action
    const actionLogEntry = await this.logAction({
      workspaceId: recommendation.workspaceId,
      recommendationId: recommendation.id,
      ruleId: recommendation.ruleId,
      entityType: recommendation.entityType,
      entityKey: recommendation.entityKey,
      amazonEntityId: keyword.amazonKeywordId,
      actionType: 'pause',
      beforeValue,
      afterValue,
      rationale: suggestedAction.reason || `Keyword paused due to poor performance`,
      executedBy,
      status: dryRun ? 'simulated' : 'success',
      apiRequest,
      apiResponse,
      isReversible: true,
      dryRun,
    });

    return {
      success: true,
      actionId: actionLogEntry.id,
      dryRun,
      beforeValue,
      afterValue,
      apiRequest,
      apiResponse,
    };
  }

  /**
   * Execute la creation d'un keyword (placeholder)
   */
  private async executeCreateKeyword(
    recommendation: Recommendation,
    suggestedAction: Record<string, any>,
    dryRun: boolean,
    executedBy: string,
  ): Promise<ExecuteActionResult> {
    // Placeholder - a implementer avec l'API Amazon createKeyword
    const actionLog = await this.logAction({
      workspaceId: recommendation.workspaceId,
      recommendationId: recommendation.id,
      ruleId: recommendation.ruleId,
      entityType: recommendation.entityType,
      entityKey: recommendation.entityKey,
      actionType: 'create_keyword',
      beforeValue: null,
      afterValue: suggestedAction,
      rationale: 'Keyword harvest from search term',
      executedBy,
      status: dryRun ? 'simulated' : 'pending',
      dryRun,
    });

    this.logger.log(`create_keyword action logged (placeholder): ${actionLog.id}`);

    return {
      success: true,
      actionId: actionLog.id,
      dryRun,
      afterValue: suggestedAction,
    };
  }

  /**
   * Execute la creation d'un negative keyword (placeholder)
   */
  private async executeCreateNegative(
    recommendation: Recommendation,
    suggestedAction: Record<string, any>,
    dryRun: boolean,
    executedBy: string,
  ): Promise<ExecuteActionResult> {
    // Placeholder - a implementer avec l'API Amazon createNegativeKeyword
    const actionLog = await this.logAction({
      workspaceId: recommendation.workspaceId,
      recommendationId: recommendation.id,
      ruleId: recommendation.ruleId,
      entityType: recommendation.entityType,
      entityKey: recommendation.entityKey,
      actionType: 'create_negative',
      beforeValue: null,
      afterValue: suggestedAction,
      rationale: suggestedAction.reason || 'Add negative keyword',
      executedBy,
      status: dryRun ? 'simulated' : 'pending',
      dryRun,
    });

    this.logger.log(`create_negative action logged (placeholder): ${actionLog.id}`);

    return {
      success: true,
      actionId: actionLog.id,
      dryRun,
      afterValue: suggestedAction,
    };
  }

  // ============================================
  // BATCH EXECUTION
  // ============================================

  /**
   * Execute un batch de recommandations
   */
  async executeBatch(options: ExecuteBatchOptions): Promise<ExecuteBatchResult> {
    const {
      recommendationIds,
      dryRun = false,
      executedBy = 'system',
      stopOnError = false,
    } = options;

    this.logger.log(`Executing batch of ${recommendationIds.length} recommendations`);

    const result: ExecuteBatchResult = {
      total: recommendationIds.length,
      executed: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };

    for (const recommendationId of recommendationIds) {
      try {
        const execResult = await this.executeAction({
          recommendationId,
          dryRun,
          executedBy,
        });

        result.results.push({
          recommendationId,
          result: execResult,
        });

        if (execResult.success) {
          result.executed++;
        } else {
          result.failed++;
          if (stopOnError) {
            this.logger.warn(`Stopping batch execution due to error`);
            break;
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.results.push({
          recommendationId,
          result: {
            success: false,
            error: errorMessage,
            dryRun,
          },
        });
        result.failed++;

        if (stopOnError) {
          this.logger.warn(`Stopping batch execution due to error: ${errorMessage}`);
          break;
        }
      }
    }

    result.skipped = result.total - result.executed - result.failed;

    this.logger.log(
      `Batch execution complete: ${result.executed} executed, ${result.failed} failed, ${result.skipped} skipped`,
    );

    return result;
  }

  // ============================================
  // ACTION LOG
  // ============================================

  /**
   * Log une action dans action_log
   */
  private async logAction(data: Partial<NewActionLogEntry>): Promise<ActionLogEntry> {
    const [entry] = await this.db
      .insert(actionLog)
      .values({
        workspaceId: data.workspaceId!,
        recommendationId: data.recommendationId,
        ruleId: data.ruleId,
        entityType: data.entityType!,
        entityKey: data.entityKey!,
        amazonEntityId: data.amazonEntityId,
        actionType: data.actionType!,
        beforeValue: data.beforeValue,
        afterValue: data.afterValue,
        rationale: data.rationale!,
        executedBy: data.executedBy!,
        status: data.status!,
        apiRequest: data.apiRequest,
        apiResponse: data.apiResponse,
        errorMessage: data.errorMessage,
        isReversible: data.isReversible,
        dryRun: data.dryRun,
      })
      .returning();

    return entry;
  }

  /**
   * Recupere le log des actions
   */
  async getActionLog(query: ActionLogQuery): Promise<{
    data: ActionLogEntry[];
    total: number;
  }> {
    const conditions = [];

    if (query.workspaceId) {
      conditions.push(eq(actionLog.workspaceId, query.workspaceId));
    }
    if (query.entityType) {
      conditions.push(eq(actionLog.entityType, query.entityType));
    }
    if (query.entityKey) {
      conditions.push(eq(actionLog.entityKey, query.entityKey));
    }
    if (query.status) {
      conditions.push(eq(actionLog.status, query.status));
    }
    if (query.startDate) {
      conditions.push(gte(actionLog.executedAt, query.startDate));
    }
    if (query.endDate) {
      conditions.push(lte(actionLog.executedAt, query.endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Compter le total
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(actionLog)
      .where(whereClause);

    // Recuperer les donnees
    let queryBuilder = this.db
      .select()
      .from(actionLog)
      .where(whereClause)
      .orderBy(sql`${actionLog.executedAt} DESC`);

    if (query.limit) {
      queryBuilder = queryBuilder.limit(query.limit);
    }
    if (query.offset) {
      queryBuilder = queryBuilder.offset(query.offset);
    }

    const data = await queryBuilder;

    return {
      data,
      total: Number(countResult?.count || 0),
    };
  }

  /**
   * Recupere une action par ID
   */
  async getActionById(actionId: string): Promise<ActionLogEntry | null> {
    const [action] = await this.db
      .select()
      .from(actionLog)
      .where(eq(actionLog.id, actionId))
      .limit(1);

    return action || null;
  }

  // ============================================
  // HELPERS
  // ============================================

  /**
   * Verifie les limites quotidiennes
   */
  private async checkDailyLimits(
    workspaceId: string,
  ): Promise<{ canExecute: boolean; reason?: string }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(actionLog)
      .where(
        and(
          eq(actionLog.workspaceId, workspaceId),
          gte(actionLog.executedAt, todayStart),
          eq(actionLog.dryRun, false),
        ),
      );

    const count = Number(countResult?.count || 0);

    if (count >= GUARDS.MAX_ACTIONS_PER_DAY) {
      return {
        canExecute: false,
        reason: `Daily limit reached: ${count}/${GUARDS.MAX_ACTIONS_PER_DAY} actions today`,
      };
    }

    return { canExecute: true };
  }

  /**
   * Récupère le keyword + contexte (adAccountId, profileId, marketplace) par entity_key (type:amazon_id) et workspace.
   */
  private async getKeywordContextByEntityKey(
    workspaceId: string,
    amazonKeywordId: number,
  ): Promise<
    | { keyword: typeof keywords.$inferSelect; adAccountId: string; profileId: number; marketplace: string }
    | null
  > {
    const rows = await this.db
      .select({
        keyword: keywords,
        adAccountId: adAccounts.id,
        profileId: marketplaceProfiles.profileId,
        marketplace: marketplaceProfiles.marketplace,
      })
      .from(keywords)
      .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
      .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
      .innerJoin(marketplaceProfiles, eq(campaigns.profileId, marketplaceProfiles.id))
      .innerJoin(adAccounts, eq(marketplaceProfiles.adAccountId, adAccounts.id))
      .where(
        and(
          eq(adAccounts.workspaceId, workspaceId),
          eq(keywords.amazonKeywordId, amazonKeywordId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const profileId = Number(row.profileId);
    return {
      keyword: row.keyword,
      adAccountId: row.adAccountId,
      profileId: isNaN(profileId) ? 0 : profileId,
      marketplace: row.marketplace ?? 'FR',
    };
  }
}
