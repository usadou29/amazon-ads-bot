import { Injectable, Logger } from '@nestjs/common';
import { GUARDS } from '@/config/guards';
import type { LifecyclePhase } from '@/db/schema/books';
import {
  CampaignDiagnosisCode,
  EntityDiagnosisCode,
  MacroStrategyCode,
  TrendDirection,
  type ActionExecution,
  type InsightAction,
  type InsightMetrics,
  type SummaryFacts,
  type TrendAnalysis,
  type CampaignInsight,
  type CampaignMacroStrategy,
  type EntityInsight,
  type InsightCampaignInput,
  type InsightEntityInput,
} from './types';

const MIN_CLICKS = GUARDS.MIN_CLICKS_FOR_DECISION; // 15
const MIN_IMPRESSIONS = GUARDS.MIN_IMPRESSIONS_FOR_SIGNAL; // 300

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════

  computeCampaignInsight(
    campaign: InsightCampaignInput,
    metrics: InsightMetrics,
    breakEvenAcos: number,
    periodDays: number,
    entityInsights: EntityInsight[],
    dailyBudget?: number,
    trendMetrics?: InsightMetrics,
  ): CampaignInsight {
    const facts = this.buildSummaryFacts(metrics, periodDays);
    const diagnosisCode = this.diagnoseCampaign(
      metrics,
      breakEvenAcos,
      dailyBudget,
      periodDays,
    );
    const macroStrategy = this.getCampaignMacroStrategy(entityInsights);
    const trend = trendMetrics
      ? this.computeTrend(metrics, trendMetrics)
      : { direction: TrendDirection.STABLE, analysis: undefined };

    return {
      campaignId: campaign.id,
      diagnosisCode,
      summaryFacts: facts,
      macroStrategy,
      confidenceScore: this.computeConfidence(metrics.clicks),
      strategicPeriodDays: periodDays,
      trendDirection: trend.direction,
      trendAnalysis: trend.analysis,
    };
  }

  /**
   * Compute campaign macro strategy by aggregating entity insights bottom-up.
   *
   * Decision tree:
   * - winnersCount + boostCandidatesCount > 0 → SCALE_WINNERS
   * - losersCount > eligibleCount / 2 → CUT_LOSERS
   * - losersCount > 0 && winnersCount === 0 → FIX_LISTING
   * - testingCount > 0 || ignoredCount > 0 → CONTINUE_TESTING
   * - fallback → NO_SIGNAL_YET
   */
  getCampaignMacroStrategy(entityInsights: EntityInsight[]): CampaignMacroStrategy {
    let winnersCount = 0;
    let boostCandidatesCount = 0;
    let testingCount = 0;
    let ignoredCount = 0;
    let losersCount = 0;
    let expensiveCount = 0;
    let eligibleCount = 0;

    for (const ei of entityInsights) {
      if (ei.eligibility) eligibleCount++;

      switch (ei.diagnosisCode) {
        case EntityDiagnosisCode.WINNER:
          winnersCount++;
          break;
        case EntityDiagnosisCode.BOOST_CANDIDATE:
          boostCandidatesCount++;
          break;
        case EntityDiagnosisCode.VERY_LOW_CLICKS:
        case EntityDiagnosisCode.LOW_CLICKS:
          testingCount++;
          break;
        case EntityDiagnosisCode.NO_IMPRESSIONS:
        case EntityDiagnosisCode.ZERO_CLICKS:
          ignoredCount++;
          break;
        case EntityDiagnosisCode.CLICKS_NO_SALES:
          losersCount++;
          break;
        case EntityDiagnosisCode.EXPENSIVE_BUT_VALID:
          expensiveCount++;
          break;
      }
    }

    const totalEntities = entityInsights.length;
    let macroStrategyCode: MacroStrategyCode;

    if (winnersCount + boostCandidatesCount > 0) {
      macroStrategyCode = MacroStrategyCode.SCALE_WINNERS;
    } else if (eligibleCount >= 2 && losersCount > eligibleCount / 2) {
      // Majority of eligible entities are losing → aggressive cleanup needed
      macroStrategyCode = MacroStrategyCode.CUT_LOSERS;
    } else if (losersCount > 0 && winnersCount === 0) {
      // Some losers but not a clear majority → listing problem likely
      macroStrategyCode = MacroStrategyCode.FIX_LISTING;
    } else if (testingCount > 0 || ignoredCount > 0) {
      macroStrategyCode = MacroStrategyCode.CONTINUE_TESTING;
    } else {
      macroStrategyCode = MacroStrategyCode.NO_SIGNAL_YET;
    }

    return {
      macroStrategyCode,
      winnersCount,
      boostCandidatesCount,
      testingCount,
      ignoredCount,
      losersCount,
      expensiveCount,
      totalEntities,
      eligibleCount,
    };
  }

  computeEntityInsight(
    entity: InsightEntityInput,
    metrics: InsightMetrics,
    lifecyclePhase: LifecyclePhase,
    breakEvenAcos: number,
    periodDays: number,
    avgCampaignCTR?: number,
    linkedReco?: { id: string; actionType: string; strategyScore: number; strategyLabel: string } | null,
  ): EntityInsight {
    const facts = this.buildSummaryFacts(metrics, periodDays);
    const diagnosisCode = this.diagnoseEntity(metrics, breakEvenAcos, avgCampaignCTR);
    const eligibility = metrics.clicks >= MIN_CLICKS;
    const suggestedActions = this.buildEntityActions(
      diagnosisCode,
      metrics,
      lifecyclePhase,
      breakEvenAcos,
    );

    return {
      entityKey: entity.key,
      entityType: entity.type,
      diagnosisCode,
      eligibility,
      summaryFacts: facts,
      suggestedActions,
      linkedRecommendation: linkedReco ?? undefined,
      confidenceScore: this.computeConfidence(metrics.clicks),
    };
  }

  // ══════════════════════════════════════════════════════════
  // DIAGNOSIS TREES
  // ══════════════════════════════════════════════════════════

  /**
   * Campaign diagnosis decision tree.
   *
   * Priority check order:
   * 1. Budget cap (overlay — takes priority if detected)
   * 2. No impressions → INVISIBLE
   * 3. Low impressions (< MIN_IMPRESSIONS_FOR_SIGNAL) → LOW_SIGNAL
   * 4. No clicks → IGNORED
   * 5. Insufficient clicks → TOO_EARLY
   * 6. No orders with enough clicks → ATTRACTIVE_NOT_CONVERTING
   * 7. Orders with acceptable ACoS → PROFITABLE
   * 8. Orders with high ACoS → PROMISING_BUT_EXPENSIVE
   */
  diagnoseCampaign(
    metrics: InsightMetrics,
    breakEvenAcos: number,
    dailyBudget?: number,
    periodDays?: number,
  ): CampaignDiagnosisCode {
    // Budget cap overlay — check first (takes priority)
    if (
      dailyBudget &&
      dailyBudget > 0 &&
      periodDays &&
      periodDays > 0 &&
      metrics.spend >= dailyBudget * periodDays * 0.95
    ) {
      return CampaignDiagnosisCode.LIMITED_BY_BUDGET;
    }

    if (metrics.impressions === 0) {
      return CampaignDiagnosisCode.INVISIBLE;
    }

    if (metrics.impressions < MIN_IMPRESSIONS) {
      return CampaignDiagnosisCode.LOW_SIGNAL;
    }

    if (metrics.clicks === 0) {
      return CampaignDiagnosisCode.IGNORED;
    }

    if (metrics.clicks < MIN_CLICKS) {
      return CampaignDiagnosisCode.TOO_EARLY;
    }

    // Enough clicks to decide
    if (metrics.orders === 0) {
      return CampaignDiagnosisCode.ATTRACTIVE_NOT_CONVERTING;
    }

    // Has orders — compute ACoS
    const acos = metrics.sales > 0
      ? (metrics.spend / metrics.sales) * 100
      : Infinity;

    if (acos <= breakEvenAcos * 1.5) {
      return CampaignDiagnosisCode.PROFITABLE;
    }

    return CampaignDiagnosisCode.PROMISING_BUT_EXPENSIVE;
  }

  /**
   * Entity diagnosis decision tree.
   *
   * Chaque entité reçoit TOUJOURS un diagnostic humain lisible.
   * Les cas pré-eligibility (clicks < 15) ont des diagnostics précis :
   *   NO_IMPRESSIONS → ZERO_CLICKS → VERY_LOW_CLICKS → LOW_CLICKS
   * Les cas post-eligibility (clicks >= 15) ont des diagnostics actionnables :
   *   CLICKS_NO_SALES → EXPENSIVE_BUT_VALID → WINNER / BOOST_CANDIDATE
   */
  diagnoseEntity(
    metrics: InsightMetrics,
    breakEvenAcos: number,
    avgCampaignCTR?: number,
  ): EntityDiagnosisCode {
    // ── Pré-eligibility : pas assez de données pour une action ──
    if (metrics.impressions === 0) {
      return EntityDiagnosisCode.NO_IMPRESSIONS;
    }

    if (metrics.clicks === 0) {
      return EntityDiagnosisCode.ZERO_CLICKS;
    }

    if (metrics.clicks < 5) {
      return EntityDiagnosisCode.VERY_LOW_CLICKS;
    }

    if (metrics.clicks < MIN_CLICKS) {
      return EntityDiagnosisCode.LOW_CLICKS;
    }

    // ── Post-eligibility : assez de données pour décider ──
    const ctr = (metrics.clicks / metrics.impressions) * 100;

    if (metrics.orders === 0) {
      return EntityDiagnosisCode.CLICKS_NO_SALES;
    }

    // Has orders — compute ACoS
    const acos = metrics.sales > 0
      ? (metrics.spend / metrics.sales) * 100
      : Infinity;

    if (acos <= breakEvenAcos) {
      // Profitable — check for boost potential
      if (avgCampaignCTR !== undefined && avgCampaignCTR > 0 && ctr > avgCampaignCTR) {
        return EntityDiagnosisCode.BOOST_CANDIDATE;
      }
      return EntityDiagnosisCode.WINNER;
    }

    if (acos <= breakEvenAcos * 1.3) {
      return EntityDiagnosisCode.EXPENSIVE_BUT_VALID;
    }

    // ACoS too high despite orders
    return EntityDiagnosisCode.CLICKS_NO_SALES;
  }

  // ══════════════════════════════════════════════════════════
  // ACTION BUILDERS
  // ══════════════════════════════════════════════════════════

  private buildEntityActions(
    code: EntityDiagnosisCode,
    metrics: InsightMetrics,
    lifecycle: LifecyclePhase,
    breakEvenAcos: number,
  ): InsightAction[] {
    const actions = this.getEntityBaseActions(code);
    return this.applyLifecycleModifiers(actions, lifecycle, metrics, breakEvenAcos);
  }

  /**
   * Base actions per entity diagnosis code.
   */
  private getEntityBaseActions(code: EntityDiagnosisCode): InsightAction[] {
    const actionMap: Record<EntityDiagnosisCode, InsightAction[]> = {
      [EntityDiagnosisCode.NO_IMPRESSIONS]: [
        this.action('bid_up', 'ads', 'insights.actions.bid_up', 1),
      ],
      [EntityDiagnosisCode.ZERO_CLICKS]: [
        this.action('improve_cover', 'book', 'insights.actions.improve_cover', 1),
        this.action('monitor', 'none', 'insights.actions.monitor', 2),
      ],
      [EntityDiagnosisCode.VERY_LOW_CLICKS]: [
        this.action('patience', 'none', 'insights.actions.patience', 1),
        this.action('monitor', 'none', 'insights.actions.monitor', 2),
      ],
      [EntityDiagnosisCode.LOW_CLICKS]: [
        this.action('monitor', 'none', 'insights.actions.monitor', 1),
        this.action('patience', 'none', 'insights.actions.patience', 2),
      ],
      [EntityDiagnosisCode.CLICKS_NO_SALES]: [
        this.action('improve_listing', 'book', 'insights.actions.improve_listing', 1),
        this.action('add_negative', 'ads', 'insights.actions.add_negative', 2),
      ],
      [EntityDiagnosisCode.EXPENSIVE_BUT_VALID]: [
        this.action('bid_down', 'ads', 'insights.actions.bid_down', 1),
      ],
      [EntityDiagnosisCode.WINNER]: [
        this.action('bid_up', 'ads', 'insights.actions.bid_up', 1),
        this.action('harvest', 'ads', 'insights.actions.harvest', 2),
      ],
      [EntityDiagnosisCode.BOOST_CANDIDATE]: [
        this.action('bid_up', 'ads', 'insights.actions.bid_up', 1),
      ],
    };
    return actionMap[code] || [];
  }

  /**
   * Lifecycle modifiers:
   * - launch: add patience, remove pause, deprioritize aggressive actions
   * - scale: prioritize growth (bid_up, harvest)
   * - evergreen: prioritize maintenance (bid_down, monitor)
   * - relaunch: prioritize listing improvements
   */
  private applyLifecycleModifiers(
    actions: InsightAction[],
    lifecycle: LifecyclePhase,
    metrics: InsightMetrics,
    breakEvenAcos: number,
  ): InsightAction[] {
    let result = [...actions];

    // Break-even guard: NEVER suggest pause for profitable entities
    const acos = metrics.sales > 0 ? (metrics.spend / metrics.sales) * 100 : null;
    if (metrics.orders >= 1 && acos !== null && acos <= breakEvenAcos) {
      result = result.filter(a => a.type !== 'pause');
    }

    switch (lifecycle) {
      case 'launch':
        // Remove pause entirely in launch (unless very wasteful)
        if (!(metrics.orders === 0 && metrics.clicks >= MIN_CLICKS * 2 && metrics.spend > 0)) {
          result = result.filter(a => a.type !== 'pause');
        }
        // Add patience if not already present
        if (!result.find(a => a.type === 'patience')) {
          result.push(this.action('patience', 'none', 'insights.actions.patience', result.length + 1));
        }
        // Deprioritize aggressive ads actions
        result = result.map(a => {
          if (a.execution === 'ads' && a.type !== 'monitor') {
            return { ...a, priority: a.priority + 1 };
          }
          return a;
        });
        break;

      case 'scale':
        // Boost growth actions
        result = result.map(a => {
          if (a.type === 'bid_up' || a.type === 'harvest') {
            return { ...a, priority: Math.max(1, a.priority - 1) };
          }
          return a;
        });
        break;

      case 'evergreen':
        // Boost maintenance, add monitor if missing
        result = result.map(a => {
          if (a.type === 'bid_down' || a.type === 'monitor') {
            return { ...a, priority: Math.max(1, a.priority - 1) };
          }
          return a;
        });
        if (!result.find(a => a.type === 'monitor')) {
          result.push(this.action('monitor', 'none', 'insights.actions.monitor', result.length + 1));
        }
        break;

      case 'relaunch':
        // Boost listing improvements
        result = result.map(a => {
          if (a.execution === 'book') {
            return { ...a, priority: Math.max(1, a.priority - 1) };
          }
          return a;
        });
        if (!result.find(a => a.type === 'patience')) {
          result.push(this.action('patience', 'none', 'insights.actions.patience', result.length + 1));
        }
        break;
    }

    // Sort by priority and limit to 3
    return result
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 3);
  }

  // ══════════════════════════════════════════════════════════
  // TREND ANALYSIS
  // ══════════════════════════════════════════════════════════

  /**
   * Compare short-term (7j) metrics to strategic-period metrics.
   * Returns UP if ACoS is dropping or CVR is rising,
   * DOWN if ACoS is rising or CVR is dropping,
   * STABLE otherwise.
   *
   * Threshold: 15% variation to trigger UP or DOWN.
   */
  computeTrend(
    strategicMetrics: InsightMetrics,
    trendMetrics: InsightMetrics,
  ): { direction: TrendDirection; analysis: TrendAnalysis } {
    const strategicAcos = strategicMetrics.sales > 0
      ? (strategicMetrics.spend / strategicMetrics.sales) * 100
      : null;
    const trendAcos = trendMetrics.sales > 0
      ? (trendMetrics.spend / trendMetrics.sales) * 100
      : null;
    const strategicCvr = strategicMetrics.clicks > 0
      ? (strategicMetrics.orders / strategicMetrics.clicks) * 100
      : null;
    const trendCvr = trendMetrics.clicks > 0
      ? (trendMetrics.orders / trendMetrics.clicks) * 100
      : null;

    const analysis: TrendAnalysis = {
      strategicAcos: strategicAcos !== null ? Math.round(strategicAcos * 100) / 100 : null,
      trendAcos: trendAcos !== null ? Math.round(trendAcos * 100) / 100 : null,
      strategicCvr: strategicCvr !== null ? Math.round(strategicCvr * 100) / 100 : null,
      trendCvr: trendCvr !== null ? Math.round(trendCvr * 100) / 100 : null,
    };

    // Not enough trend data → STABLE
    if (trendMetrics.clicks === 0) {
      return { direction: TrendDirection.STABLE, analysis };
    }

    // Not enough strategic data to compare → STABLE
    if (strategicMetrics.clicks === 0) {
      return { direction: TrendDirection.STABLE, analysis };
    }

    let isUp = false;
    let isDown = false;

    // ACoS comparison (lower is better → lower trendAcos = UP)
    if (strategicAcos !== null && trendAcos !== null && strategicAcos > 0) {
      if (trendAcos < strategicAcos * 0.85) isUp = true;
      if (trendAcos > strategicAcos * 1.15) isDown = true;
    }

    // CVR comparison (higher is better → higher trendCvr = UP)
    if (strategicCvr !== null && trendCvr !== null && strategicCvr > 0) {
      if (trendCvr > strategicCvr * 1.15) isUp = true;
      if (trendCvr < strategicCvr * 0.85) isDown = true;
    }

    // UP takes priority over DOWN (mixed signals = improving)
    if (isUp) return { direction: TrendDirection.UP, analysis };
    if (isDown) return { direction: TrendDirection.DOWN, analysis };
    return { direction: TrendDirection.STABLE, analysis };
  }

  // ══════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════

  private buildSummaryFacts(metrics: InsightMetrics, periodDays: number): SummaryFacts {
    const ctr = metrics.impressions > 0
      ? Math.round((metrics.clicks / metrics.impressions) * 10000) / 100
      : null;
    const cvr = metrics.clicks > 0
      ? Math.round((metrics.orders / metrics.clicks) * 10000) / 100
      : null;
    const acos = metrics.sales > 0
      ? Math.round((metrics.spend / metrics.sales) * 10000) / 100
      : null;

    return {
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      ctr,
      orders: metrics.orders,
      cvr,
      spend: Math.round(metrics.spend * 100) / 100,
      sales: Math.round(metrics.sales * 100) / 100,
      acos,
      periodDays,
    };
  }

  /**
   * Confidence scoring based on click volume.
   * More clicks = more reliable diagnosis.
   */
  computeConfidence(clicks: number): number {
    if (clicks === 0) return 10;
    if (clicks < MIN_CLICKS) {
      return Math.round(30 + (clicks / MIN_CLICKS) * 20);
    }
    if (clicks <= 100) {
      return Math.round(50 + ((clicks - MIN_CLICKS) / 85) * 20);
    }
    // 100+ clicks
    const bonus = Math.min((clicks - 100) / 400, 1) * 30;
    return Math.min(100, Math.round(70 + bonus));
  }

  private action(
    type: string,
    execution: ActionExecution,
    i18nKey: string,
    priority: number,
  ): InsightAction {
    return { type, execution, i18nKey, priority };
  }
}
