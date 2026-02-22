import { Injectable, Logger } from '@nestjs/common';
import { GUARDS } from '@/config/guards';
import type { LifecyclePhase } from '@/db/schema/books';
import {
  CampaignDiagnosisCode,
  EntityDiagnosisCode,
  type ActionExecution,
  type InsightAction,
  type InsightMetrics,
  type SummaryFacts,
  type CampaignInsight,
  type EntityInsight,
  type InsightCampaignInput,
  type InsightEntityInput,
} from './types';

const MIN_CLICKS = GUARDS.MIN_CLICKS_FOR_DECISION; // 15

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════

  computeCampaignInsight(
    campaign: InsightCampaignInput,
    metrics: InsightMetrics,
    lifecyclePhase: LifecyclePhase,
    breakEvenAcos: number,
    periodDays: number,
  ): CampaignInsight {
    const facts = this.buildSummaryFacts(metrics, periodDays);
    const diagnosisCode = this.diagnoseCampaign(
      metrics,
      breakEvenAcos,
      campaign.dailyBudget ?? undefined,
      periodDays,
    );
    const suggestedActions = this.buildCampaignActions(
      diagnosisCode,
      metrics,
      lifecyclePhase,
      breakEvenAcos,
    );

    return {
      campaignId: campaign.id,
      diagnosisCode,
      summaryFacts: facts,
      suggestedActions,
      confidenceScore: this.computeConfidence(metrics.clicks),
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
   * 3. No clicks → IGNORED
   * 4. Insufficient clicks → TOO_EARLY
   * 5. No orders with enough clicks → ATTRACTIVE_NOT_CONVERTING
   * 6. Orders with acceptable ACoS → PROFITABLE
   * 7. Orders with high ACoS → PROMISING_BUT_EXPENSIVE
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
   */
  diagnoseEntity(
    metrics: InsightMetrics,
    breakEvenAcos: number,
    avgCampaignCTR?: number,
  ): EntityDiagnosisCode {
    if (metrics.impressions === 0) {
      return EntityDiagnosisCode.NO_IMPRESSIONS;
    }

    const ctr = metrics.impressions > 0
      ? (metrics.clicks / metrics.impressions) * 100
      : 0;

    if (metrics.clicks < 5 || ctr < 0.3) {
      return EntityDiagnosisCode.LOW_CTR;
    }

    if (metrics.clicks < MIN_CLICKS) {
      return EntityDiagnosisCode.TOO_EARLY;
    }

    // Enough clicks to decide
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

  private buildCampaignActions(
    code: CampaignDiagnosisCode,
    metrics: InsightMetrics,
    lifecycle: LifecyclePhase,
    breakEvenAcos: number,
  ): InsightAction[] {
    const actions = this.getCampaignBaseActions(code);
    return this.applyLifecycleModifiers(actions, lifecycle, metrics, breakEvenAcos);
  }

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
   * Base actions per campaign diagnosis code.
   */
  private getCampaignBaseActions(code: CampaignDiagnosisCode): InsightAction[] {
    const actionMap: Record<CampaignDiagnosisCode, InsightAction[]> = {
      [CampaignDiagnosisCode.INVISIBLE]: [
        this.action('bid_up', 'ads', 'insights.actions.bid_up', 1),
        this.action('improve_listing', 'book', 'insights.actions.improve_listing', 2),
        this.action('monitor', 'none', 'insights.actions.monitor', 3),
      ],
      [CampaignDiagnosisCode.IGNORED]: [
        this.action('improve_cover', 'book', 'insights.actions.improve_cover', 1),
        this.action('bid_up', 'ads', 'insights.actions.bid_up', 2),
      ],
      [CampaignDiagnosisCode.TOO_EARLY]: [
        this.action('monitor', 'none', 'insights.actions.monitor', 1),
      ],
      [CampaignDiagnosisCode.ATTRACTIVE_NOT_CONVERTING]: [
        this.action('improve_listing', 'book', 'insights.actions.improve_listing', 1),
        this.action('bid_down', 'ads', 'insights.actions.bid_down', 2),
      ],
      [CampaignDiagnosisCode.PROMISING_BUT_EXPENSIVE]: [
        this.action('bid_down', 'ads', 'insights.actions.bid_down', 1),
        this.action('improve_listing', 'book', 'insights.actions.improve_listing', 2),
      ],
      [CampaignDiagnosisCode.PROFITABLE]: [
        this.action('bid_up', 'ads', 'insights.actions.bid_up', 1),
        this.action('harvest', 'ads', 'insights.actions.harvest', 2),
      ],
      [CampaignDiagnosisCode.LIMITED_BY_BUDGET]: [
        this.action('budget_increase', 'ads', 'insights.actions.budget_increase', 1),
      ],
    };
    return actionMap[code] || [];
  }

  /**
   * Base actions per entity diagnosis code.
   */
  private getEntityBaseActions(code: EntityDiagnosisCode): InsightAction[] {
    const actionMap: Record<EntityDiagnosisCode, InsightAction[]> = {
      [EntityDiagnosisCode.NO_IMPRESSIONS]: [
        this.action('bid_up', 'ads', 'insights.actions.bid_up', 1),
      ],
      [EntityDiagnosisCode.LOW_CTR]: [
        this.action('improve_cover', 'book', 'insights.actions.improve_cover', 1),
        this.action('monitor', 'none', 'insights.actions.monitor', 2),
      ],
      [EntityDiagnosisCode.TOO_EARLY]: [
        this.action('monitor', 'none', 'insights.actions.monitor', 1),
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
