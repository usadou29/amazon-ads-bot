import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import {
  rules,
  recommendations,
  dailyMetrics,
  workspaces,
  Rule,
  NewRule,
  RuleConditions,
  RuleAction,
  Recommendation,
  NewRecommendation,
} from '@/db/schema';
import { eq, and, gte, lte, desc, sql, isNull, or } from 'drizzle-orm';
import { GUARDS } from '@/config/guards';
import {
  RuleEvaluator,
  AggregatedMetrics,
  EvaluationResult,
} from './rule-evaluator';

// Types de regles supportes
export const RULE_TYPES = [
  'bid_adjustment',
  'pause_keyword',
  'harvest_search_term',
  'add_negative',
  'acos_alert',
] as const;
export type RuleType = typeof RULE_TYPES[number];

// Entites sur lesquelles les regles peuvent s'appliquer
export const APPLIES_TO = ['campaign', 'ad_group', 'keyword', 'target', 'search_term'] as const;
export type AppliesTo = typeof APPLIES_TO[number];

export interface EvaluateRulesOptions {
  workspaceId: string;
  profileId?: string;
  entityType?: AppliesTo;
  entityKeys?: string[];
  periodDays?: number;
  dryRun?: boolean;
}

export interface EvaluateRulesResult {
  rulesEvaluated: number;
  entitiesEvaluated: number;
  recommendationsCreated: number;
  recommendationsSkipped: number;
  errors: Array<{ ruleId: string; entityKey: string; error: string }>;
  details: Array<{
    ruleId: string;
    ruleName: string;
    entityKey: string;
    matched: boolean;
    reason: string;
    recommendationId?: string;
    skippedReason?: string;
  }>;
}

export interface EntityMetricsRow {
  entityType: string;
  entityKey: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
}

@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);
  private readonly evaluator: RuleEvaluator;

  constructor(@Inject(DATABASE_CONNECTION) private db: any) {
    this.evaluator = new RuleEvaluator();
  }

  // ============================================
  // CRUD OPERATIONS
  // ============================================

  /**
   * Liste toutes les regles actives d'un workspace
   */
  async listRules(
    workspaceId: string,
    options?: { activeOnly?: boolean; ruleType?: RuleType },
  ): Promise<Rule[]> {
    const conditions = [eq(rules.workspaceId, workspaceId)];

    if (options?.activeOnly !== false) {
      conditions.push(eq(rules.isActive, true));
    }

    if (options?.ruleType) {
      conditions.push(eq(rules.ruleType, options.ruleType));
    }

    const result = await this.db
      .select()
      .from(rules)
      .where(and(...conditions))
      .orderBy(rules.priority, rules.createdAt);

    return result;
  }

  /**
   * Recupere une regle par son ID
   */
  async getRuleById(ruleId: string): Promise<Rule | null> {
    const [rule] = await this.db
      .select()
      .from(rules)
      .where(eq(rules.id, ruleId))
      .limit(1);

    return rule || null;
  }

  /**
   * Cree une nouvelle regle
   */
  async createRule(data: NewRule): Promise<Rule> {
    // Valider le workspace
    const [workspace] = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, data.workspaceId))
      .limit(1);

    if (!workspace) {
      throw new NotFoundException(`Workspace ${data.workspaceId} not found`);
    }

    const [newRule] = await this.db
      .insert(rules)
      .values({
        ...data,
        cooldownHours: data.cooldownHours || GUARDS.DEFAULT_COOLDOWN_HOURS,
        maxDailyExecutions: data.maxDailyExecutions || GUARDS.MAX_ACTIONS_PER_RULE_PER_DAY,
      })
      .returning();

    this.logger.log(`Created rule ${newRule.id}: ${newRule.name}`);
    return newRule;
  }

  /**
   * Met a jour une regle
   */
  async updateRule(
    ruleId: string,
    updates: Partial<Omit<Rule, 'id' | 'workspaceId' | 'createdAt'>>,
  ): Promise<Rule> {
    const existingRule = await this.getRuleById(ruleId);
    if (!existingRule) {
      throw new NotFoundException(`Rule ${ruleId} not found`);
    }

    const [updatedRule] = await this.db
      .update(rules)
      .set({
        ...updates,
        version: (existingRule.version || 1) + 1,
        updatedAt: new Date(),
      })
      .where(eq(rules.id, ruleId))
      .returning();

    this.logger.log(`Updated rule ${ruleId}: version ${updatedRule.version}`);
    return updatedRule;
  }

  /**
   * Desactive une regle (soft delete)
   */
  async deactivateRule(ruleId: string): Promise<Rule> {
    return this.updateRule(ruleId, { isActive: false });
  }

  // ============================================
  // RULE EVALUATION
  // ============================================

  /**
   * Evalue les regles contre les metriques et cree des recommandations
   */
  async evaluateRules(options: EvaluateRulesOptions): Promise<EvaluateRulesResult> {
    const {
      workspaceId,
      profileId,
      entityType,
      entityKeys,
      periodDays = 7,
      dryRun = false,
    } = options;

    this.logger.log(
      `Evaluating rules for workspace ${workspaceId}, ` +
      `period=${periodDays}d, dryRun=${dryRun}`,
    );

    const result: EvaluateRulesResult = {
      rulesEvaluated: 0,
      entitiesEvaluated: 0,
      recommendationsCreated: 0,
      recommendationsSkipped: 0,
      errors: [],
      details: [],
    };

    // Recuperer les regles actives
    const activeRules = await this.listRules(workspaceId, { activeOnly: true });
    if (activeRules.length === 0) {
      this.logger.debug('No active rules found');
      return result;
    }

    // Recuperer les metriques agregees par entite
    const metricsData = await this.getAggregatedMetrics(
      workspaceId,
      periodDays,
      profileId,
      entityType,
      entityKeys,
    );

    if (metricsData.length === 0) {
      this.logger.debug('No metrics data found');
      return result;
    }

    result.entitiesEvaluated = metricsData.length;
    result.rulesEvaluated = activeRules.length;

    // Evaluer chaque regle contre chaque entite
    for (const rule of activeRules) {
      // Filtrer les entites par type si la regle specifie appliesTo
      const applicableEntities = metricsData.filter(
        (m) => !rule.appliesTo || m.entityType === rule.appliesTo,
      );

      for (const entityMetrics of applicableEntities) {
        try {
          const evaluationResult = await this.evaluateSingleRule(
            rule,
            entityMetrics,
            periodDays,
            dryRun,
          );

          result.details.push({
            ruleId: rule.id,
            ruleName: rule.name,
            entityKey: entityMetrics.entityKey,
            matched: evaluationResult.matched,
            reason: evaluationResult.reason || '',
            recommendationId: evaluationResult.recommendationId,
            skippedReason: evaluationResult.skippedReason,
          });

          if (evaluationResult.recommendationId) {
            result.recommendationsCreated++;
          } else if (evaluationResult.matched && evaluationResult.skippedReason) {
            result.recommendationsSkipped++;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push({
            ruleId: rule.id,
            entityKey: entityMetrics.entityKey,
            error: errorMessage,
          });
          this.logger.error(
            `Error evaluating rule ${rule.id} for entity ${entityMetrics.entityKey}: ${errorMessage}`,
          );
        }
      }
    }

    this.logger.log(
      `Evaluation complete: ${result.recommendationsCreated} recommendations created, ` +
      `${result.recommendationsSkipped} skipped, ${result.errors.length} errors`,
    );

    return result;
  }

  /**
   * Evalue une seule regle contre une entite
   */
  private async evaluateSingleRule(
    rule: Rule,
    entityMetrics: EntityMetricsRow,
    periodDays: number,
    dryRun: boolean,
  ): Promise<{
    matched: boolean;
    reason?: string;
    recommendationId?: string;
    skippedReason?: string;
  }> {
    // Calculer les KPIs
    const metrics = RuleEvaluator.calculateKPIs({
      impressions: entityMetrics.impressions,
      clicks: entityMetrics.clicks,
      spend: Number(entityMetrics.spend),
      sales: Number(entityMetrics.sales),
      orders: entityMetrics.orders,
      units: entityMetrics.units,
    });

    // Verifier les donnees minimales
    if (!this.evaluator.hasMinimumDataForDecision(metrics)) {
      return {
        matched: false,
        reason: 'Insufficient data for decision',
        skippedReason: `Needs ${GUARDS.MIN_CLICKS_FOR_DECISION} clicks or $${GUARDS.MIN_SPEND_FOR_DECISION} spend`,
      };
    }

    // Evaluer les conditions
    const conditions = rule.conditions as RuleConditions;
    const evaluationResult = this.evaluator.evaluate(conditions, metrics);

    if (!evaluationResult.matched) {
      return {
        matched: false,
        reason: evaluationResult.reason,
      };
    }

    // Verifier le cooldown
    const cooldownCheck = await this.checkCooldown(
      rule.id,
      entityMetrics.entityType,
      entityMetrics.entityKey,
      rule.cooldownHours || GUARDS.DEFAULT_COOLDOWN_HOURS,
    );

    if (!cooldownCheck.canCreate) {
      return {
        matched: true,
        reason: evaluationResult.reason,
        skippedReason: cooldownCheck.reason,
      };
    }

    // Verifier les executions quotidiennes
    const dailyCheck = await this.checkDailyExecutions(
      rule.id,
      rule.maxDailyExecutions || GUARDS.MAX_ACTIONS_PER_RULE_PER_DAY,
    );

    if (!dailyCheck.canCreate) {
      return {
        matched: true,
        reason: evaluationResult.reason,
        skippedReason: dailyCheck.reason,
      };
    }

    // Creer la recommandation si pas en dry run
    if (dryRun) {
      return {
        matched: true,
        reason: evaluationResult.reason,
        skippedReason: 'Dry run mode',
      };
    }

    const recommendation = await this.createRecommendation(
      rule,
      entityMetrics,
      metrics,
      evaluationResult,
      periodDays,
    );

    return {
      matched: true,
      reason: evaluationResult.reason,
      recommendationId: recommendation.id,
    };
  }

  /**
   * Verifie si le cooldown est respecte
   */
  private async checkCooldown(
    ruleId: string,
    entityType: string,
    entityKey: string,
    cooldownHours: number,
  ): Promise<{ canCreate: boolean; reason?: string }> {
    const cooldownDate = new Date();
    cooldownDate.setHours(cooldownDate.getHours() - cooldownHours);

    const recentRecos = await this.db
      .select()
      .from(recommendations)
      .where(
        and(
          eq(recommendations.ruleId, ruleId),
          eq(recommendations.entityType, entityType),
          eq(recommendations.entityKey, entityKey),
          gte(recommendations.createdAt, cooldownDate),
        ),
      )
      .limit(1);

    if (recentRecos.length > 0) {
      const lastReco = recentRecos[0];
      const hoursAgo = Math.round(
        (Date.now() - new Date(lastReco.createdAt).getTime()) / (1000 * 60 * 60),
      );
      return {
        canCreate: false,
        reason: `Cooldown: last recommendation ${hoursAgo}h ago (need ${cooldownHours}h)`,
      };
    }

    return { canCreate: true };
  }

  /**
   * Verifie les executions quotidiennes d'une regle
   */
  private async checkDailyExecutions(
    ruleId: string,
    maxDaily: number,
  ): Promise<{ canCreate: boolean; reason?: string }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayRecos = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(recommendations)
      .where(
        and(
          eq(recommendations.ruleId, ruleId),
          gte(recommendations.createdAt, todayStart),
        ),
      );

    const count = Number(todayRecos[0]?.count || 0);

    if (count >= maxDaily) {
      return {
        canCreate: false,
        reason: `Daily limit reached: ${count}/${maxDaily} recommendations today`,
      };
    }

    return { canCreate: true };
  }

  /**
   * Cree une recommandation
   */
  private async createRecommendation(
    rule: Rule,
    entityMetrics: EntityMetricsRow,
    metrics: AggregatedMetrics,
    evaluationResult: EvaluationResult,
    periodDays: number,
  ): Promise<Recommendation> {
    const actions = rule.actions as RuleAction;

    // Calculer le score de confiance base sur les donnees
    const confidenceScore = this.calculateConfidence(metrics, periodDays);

    // Construire l'action suggeree
    const suggestedAction = this.buildSuggestedAction(rule, actions, metrics);

    // Snapshot de la regle pour l'audit
    const ruleSnapshot = {
      ruleId: rule.id,
      ruleName: rule.name,
      ruleVersion: rule.version,
      conditions: rule.conditions,
      actions: rule.actions,
      evaluatedAt: new Date().toISOString(),
    };

    // Context data avec les metriques
    const contextData = {
      periodDays,
      metrics: {
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        spend: metrics.spend,
        sales: metrics.sales,
        orders: metrics.orders,
        acos: metrics.acos,
        ctr: metrics.ctr,
        cvr: metrics.cvr,
      },
      evaluationReason: evaluationResult.reason,
      conditionResults: evaluationResult.conditionResults,
    };

    const [recommendation] = await this.db
      .insert(recommendations)
      .values({
        workspaceId: rule.workspaceId,
        ruleId: rule.id,
        entityType: entityMetrics.entityType,
        entityKey: entityMetrics.entityKey,
        actionType: rule.ruleType,
        suggestedAction,
        contextData,
        confidenceScore: String(confidenceScore),
        ruleSnapshot,
        status: rule.mode === 'auto' ? 'approved' : 'pending',
        expiresAt: this.calculateExpirationDate(),
      })
      .returning();

    this.logger.debug(
      `Created recommendation ${recommendation.id} for rule ${rule.name} on ${entityMetrics.entityKey}`,
    );

    return recommendation;
  }

  /**
   * Calcule le score de confiance
   */
  private calculateConfidence(metrics: AggregatedMetrics, periodDays: number): number {
    // Base confidence
    let confidence = 0.5;

    // Plus de clicks = plus de confiance
    if (metrics.clicks >= 50) confidence += 0.2;
    else if (metrics.clicks >= 30) confidence += 0.15;
    else if (metrics.clicks >= 20) confidence += 0.1;

    // Plus de jours = plus de confiance
    if (periodDays >= 14) confidence += 0.1;
    else if (periodDays >= 7) confidence += 0.05;

    // Presence de conversions = plus de confiance
    if (metrics.orders > 0) confidence += 0.1;

    // Cap a 0.95
    return Math.min(0.95, confidence);
  }

  /**
   * Construit l'action suggeree
   */
  private buildSuggestedAction(
    rule: Rule,
    actions: RuleAction,
    metrics: AggregatedMetrics,
  ): Record<string, any> {
    const baseAction = {
      action_type: actions.action_type || rule.ruleType,
      created_from_rule: rule.id,
    };

    switch (rule.ruleType) {
      case 'bid_adjustment':
        return {
          ...baseAction,
          adjustment_type: actions.adjustment_type || 'percentage',
          adjustment_value: actions.adjustment_value,
          min_bid: actions.min_value ?? GUARDS.MIN_BID,
          max_bid: actions.max_value ?? GUARDS.MAX_BID,
          current_metrics: {
            acos: metrics.acos,
            cpc: metrics.cpc,
          },
        };

      case 'pause_keyword':
        return {
          ...baseAction,
          new_state: 'paused',
          reason: `ACOS: ${metrics.acos.toFixed(1)}%, Spend: $${metrics.spend.toFixed(2)}, Orders: ${metrics.orders}`,
        };

      case 'harvest_search_term':
        return {
          ...baseAction,
          target_match_type: actions.match_type || 'exact',
          suggested_bid: metrics.cpc > 0 ? metrics.cpc * 1.2 : GUARDS.MIN_BID,
        };

      case 'add_negative':
        return {
          ...baseAction,
          negative_type: actions.match_type || 'phrase',
          level: actions.level || 'campaign',
          reason: `${metrics.clicks} clicks, ${metrics.orders} orders, ACOS: ${metrics.acos.toFixed(1)}%`,
        };

      case 'acos_alert':
        return {
          ...baseAction,
          severity: actions.severity || (metrics.acos > 100 ? 'high' : 'medium'),
          current_acos: metrics.acos,
          target_acos: GUARDS.DEFAULT_ACOS_TARGET,
          message: `ACOS at ${metrics.acos.toFixed(1)}% exceeds target of ${GUARDS.DEFAULT_ACOS_TARGET}%`,
        };

      default:
        return baseAction;
    }
  }

  /**
   * Calcule la date d'expiration (7 jours par defaut)
   */
  private calculateExpirationDate(): Date {
    const expiration = new Date();
    expiration.setDate(expiration.getDate() + 7);
    return expiration;
  }

  // ============================================
  // METRICS AGGREGATION
  // ============================================

  /**
   * Recupere les metriques agregees par entite
   */
  private async getAggregatedMetrics(
    workspaceId: string,
    periodDays: number,
    profileId?: string,
    entityType?: string,
    entityKeys?: string[],
  ): Promise<EntityMetricsRow[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);
    const startDateStr = startDate.toISOString().split('T')[0];

    // Construire la requete SQL
    // Note: Cette requete suppose que daily_metrics a une colonne profile_id
    // qui peut etre liee au workspace via marketplace_profiles
    let query = sql`
      SELECT
        dm.entity_type as "entityType",
        dm.entity_key as "entityKey",
        COALESCE(SUM(dm.impressions), 0)::int as impressions,
        COALESCE(SUM(dm.clicks), 0)::int as clicks,
        COALESCE(SUM(dm.spend), 0)::numeric as spend,
        COALESCE(SUM(dm.sales), 0)::numeric as sales,
        COALESCE(SUM(dm.orders), 0)::int as orders,
        COALESCE(SUM(dm.units), 0)::int as units
      FROM daily_metrics dm
      INNER JOIN marketplace_profiles mp ON dm.profile_id = mp.id
      INNER JOIN ad_accounts aa ON mp.ad_account_id = aa.id
      WHERE aa.workspace_id = ${workspaceId}
        AND dm.date >= ${startDateStr}
    `;

    if (profileId) {
      query = sql`${query} AND dm.profile_id = ${profileId}`;
    }

    if (entityType) {
      query = sql`${query} AND dm.entity_type = ${entityType}`;
    }

    if (entityKeys && entityKeys.length > 0) {
      query = sql`${query} AND dm.entity_key = ANY(${entityKeys})`;
    }

    query = sql`${query} GROUP BY dm.entity_type, dm.entity_key`;

    const result = await this.db.execute(query);
    return result.rows as EntityMetricsRow[];
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Recupere les recommandations pending pour un workspace
   */
  async getPendingRecommendations(
    workspaceId: string,
    limit = 50,
  ): Promise<Recommendation[]> {
    return this.db
      .select()
      .from(recommendations)
      .where(
        and(
          eq(recommendations.workspaceId, workspaceId),
          eq(recommendations.status, 'pending'),
          or(
            isNull(recommendations.expiresAt),
            gte(recommendations.expiresAt, new Date()),
          ),
        ),
      )
      .orderBy(desc(recommendations.confidenceScore), recommendations.createdAt)
      .limit(limit);
  }

  /**
   * Met a jour le statut d'une recommandation
   */
  async updateRecommendationStatus(
    recommendationId: string,
    status: 'approved' | 'rejected' | 'executed' | 'skipped',
    reviewedBy?: string,
  ): Promise<Recommendation> {
    const [updated] = await this.db
      .update(recommendations)
      .set({
        status,
        reviewedAt: new Date(),
        reviewedBy,
      })
      .where(eq(recommendations.id, recommendationId))
      .returning();

    if (!updated) {
      throw new NotFoundException(`Recommendation ${recommendationId} not found`);
    }

    return updated;
  }
}
