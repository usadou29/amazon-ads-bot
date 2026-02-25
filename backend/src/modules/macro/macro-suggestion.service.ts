import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { campaigns } from '@/db/schema/campaigns';
import { dailyMetrics } from '@/db/schema/daily-metrics';
import { campaignBookMapping } from '@/db/schema/campaign-book-mapping';
import { eq, sql, and, gte } from 'drizzle-orm';
import { GUARDS } from '@/config/guards';
import { InsightsService } from '@/modules/insights/insights.service';
import type { LifecyclePhase } from '@/db/schema/books';
import type {
  MacroSuggestionDTO,
  MacroEvidence,
  BiddingStrategy,
  PlacementAdjustments,
  MacroSuggestionRequest,
} from './macro.types';

// ── Gating Thresholds ─────────────────────────────────

const GATING = {
  // Pattern 1: Global degradation
  DEGRADATION_ACOS_INCREASE: 1.10,    // ACoS trend must be 10%+ above strategic
  DEGRADATION_CVR_DECREASE: 0.90,     // CVR trend must be 10%+ below strategic
  DEGRADATION_SPEND_SHARE_MIN: 0.60,  // 60%+ of spend must be impacted

  // Pattern 2: Budget capped
  BUDGET_UTILIZATION_THRESHOLD: 0.95,  // 95%+ of daily budget used
  BUDGET_ACOS_MARGIN: 0.80,           // ACoS must be <= 80% of break-even
  BUDGET_INCREASE_PCT: 20,            // Suggest 20% budget increase

  // Pattern 3: Placement mismatch
  PLACEMENT_ACOS_RATIO: 1.30,         // TopOfSearch ACoS > 130% of campaign ACoS
  PLACEMENT_MIN_MULTIPLIER: 10,       // At least 10% topOfSearch multiplier to flag

  // Pattern 4: Bidding strategy mismatch
  BIDDING_LAUNCH_MIN_CLICKS: 50,      // Launch phase: min clicks before up&down
} as const;

// ── Service ───────────────────────────────────────────

@Injectable()
export class MacroSuggestionService {
  private readonly logger = new Logger(MacroSuggestionService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
  ) {}

  /**
   * Generate 0-2 macro suggestions for a campaign.
   * Returns empty array if no macro action is warranted ("silence = stabilité").
   */
  async getMacroSuggestions(
    campaignId: string,
    request: MacroSuggestionRequest,
  ): Promise<MacroSuggestionDTO[]> {
    const { bookId, lifecyclePhase } = request;
    const strategicDays = GUARDS.STRATEGIC_PERIOD_BY_PHASE[lifecyclePhase] || 14;
    const trendDays = GUARDS.TREND_PERIOD_DAYS || 7;

    // Load campaign data
    const campaign = await this.loadCampaign(campaignId);
    if (!campaign) {
      this.logger.warn(`[Macro] Campaign ${campaignId} not found`);
      return [];
    }

    // Load metrics
    const metrics = await this.loadCampaignMetrics(campaignId, strategicDays, trendDays);
    if (!metrics.strategic.spend || metrics.strategic.spend === 0) {
      return []; // No spend → no suggestions
    }

    // Load entity diagnostics distribution
    const diagnostics = await this.loadDiagnosticsDistribution(campaignId, bookId);

    // Extract current campaign settings
    const currentBidding = this.extractBiddingStrategy(campaign);
    const currentPlacements = this.extractPlacements(campaign);
    const currentBudget = campaign.dailyBudget ? Number(campaign.dailyBudget) : null;
    const breakEvenAcos = 35; // Will be passed from book context later

    // Build evidence
    const evidence: MacroEvidence = {
      strategicPeriodDays: strategicDays,
      trendPeriodDays: trendDays,
      acosStrategic: metrics.strategic.acos,
      acosTrend: metrics.trend.acos,
      cvrStrategic: metrics.strategic.cvr,
      cvrTrend: metrics.trend.cvr,
      spendShareImpacted: diagnostics.spendShareImpacted,
      budgetUtilization: currentBudget && currentBudget > 0
        ? metrics.strategic.dailySpend / currentBudget
        : undefined,
      diagnosticsDistribution: diagnostics.counts,
    };

    // Apply gating patterns
    const suggestions: MacroSuggestionDTO[] = [];

    // Pattern 1: Global degradation
    const degradation = this.checkGlobalDegradation(
      metrics, evidence, currentBidding, currentPlacements, campaignId,
    );
    if (degradation) suggestions.push(degradation);

    // Pattern 2: Budget capped + profitable
    const budgetSuggestion = this.checkBudgetCapped(
      metrics, evidence, currentBudget, breakEvenAcos, campaignId,
    );
    if (budgetSuggestion) suggestions.push(budgetSuggestion);

    // Pattern 3: Placement mismatch
    const placementSuggestion = this.checkPlacementMismatch(
      metrics, evidence, currentPlacements, campaignId,
    );
    if (placementSuggestion && suggestions.length < 2) suggestions.push(placementSuggestion);

    // Pattern 4: Bidding strategy mismatch
    const biddingSuggestion = this.checkBiddingMismatch(
      metrics, evidence, currentBidding, lifecyclePhase, breakEvenAcos, campaignId,
    );
    if (biddingSuggestion && suggestions.length < 2) suggestions.push(biddingSuggestion);

    // Cap at 2 suggestions max
    return suggestions.slice(0, 2);
  }

  // ── Pattern 1: Global Degradation ──────────────────

  private checkGlobalDegradation(
    metrics: CampaignMetrics,
    evidence: MacroEvidence,
    currentBidding: BiddingStrategy,
    currentPlacements: PlacementAdjustments | null,
    campaignId: string,
  ): MacroSuggestionDTO | null {
    const { strategic, trend } = metrics;

    // Need both strategic and trend data
    if (!strategic.acos || !trend.acos || !strategic.cvr || !trend.cvr) return null;
    if (strategic.acos === 0) return null;

    const acosRatio = trend.acos / strategic.acos;
    const cvrRatio = trend.cvr / strategic.cvr;
    const spendShare = evidence.spendShareImpacted ?? 0;

    if (
      acosRatio >= GATING.DEGRADATION_ACOS_INCREASE &&
      cvrRatio <= GATING.DEGRADATION_CVR_DECREASE &&
      spendShare >= GATING.DEGRADATION_SPEND_SHARE_MIN
    ) {
      // Determine best action
      if (currentBidding === 'up_and_down') {
        return {
          id: `macro-${campaignId}-degradation-bidding`,
          campaignId,
          title: 'Passer en mode défensif',
          why: `L'ACoS augmente et le taux de conversion baisse sur ${Math.round(spendShare * 100)}% de tes dépenses. C'est un signal de dégradation globale, pas un problème isolé.`,
          bullets: [
            'Amazon surenchérit probablement sur des placements peu rentables.',
            'Le mode "Baisses uniquement" empêche Amazon de monter les enchères tout seul.',
            'Tu pourras repasser en mode dynamique quand les chiffres se stabilisent.',
          ],
          impactTag: 'stabiliser',
          riskLevel: 'medium',
          actionType: 'set_bidding_strategy',
          executable: true,
          current: { biddingStrategy: currentBidding },
          recommended: { biddingStrategy: 'down_only' },
          guardrails: {
            requiresConsent: true,
            consentLevel: 'basic',
            cooldownDays: 7,
          },
          evidence,
        };
      }

      if (currentPlacements && currentPlacements.topOfSearch > 50) {
        return {
          id: `macro-${campaignId}-degradation-placements`,
          campaignId,
          title: 'Réduire la visibilité en tête de recherche',
          why: `La dégradation touche ${Math.round(spendShare * 100)}% de tes dépenses. Réduire le bonus "Tête de recherche" peut limiter les pertes.`,
          bullets: [
            `Ton bonus actuel de ${currentPlacements.topOfSearch}% augmente tes enchères en première page.`,
            'Baisser ce bonus réduit la visibilité mais protège la rentabilité.',
            'Impact visible sous 3-5 jours.',
          ],
          impactTag: 'stabiliser',
          riskLevel: 'medium',
          actionType: 'update_placements',
          executable: true,
          current: { placements: currentPlacements },
          recommended: {
            placements: {
              ...currentPlacements,
              topOfSearch: Math.max(0, currentPlacements.topOfSearch - 30),
            },
          },
          guardrails: {
            requiresConsent: true,
            consentLevel: 'basic',
            cooldownDays: 5,
          },
          evidence,
        };
      }

      // Non-executable suggestion (general advice)
      return {
        id: `macro-${campaignId}-degradation-advice`,
        campaignId,
        title: 'Dégradation globale détectée',
        why: `L'ACoS augmente et le taux de conversion baisse sur ${Math.round(spendShare * 100)}% de tes dépenses. Les micro-optimisations seules ne suffiront pas.`,
        bullets: [
          'Vérifie si ta fiche produit (titre, couverture, description) est toujours compétitive.',
          'Regarde si de nouveaux concurrents sont apparus sur tes mots-clés principaux.',
          'Envisage de baisser les enchères globalement plutôt que mot-clé par mot-clé.',
        ],
        impactTag: 'stabiliser',
        riskLevel: 'medium',
        actionType: 'none',
        executable: false,
        current: { biddingStrategy: currentBidding },
        evidence,
      };
    }

    return null;
  }

  // ── Pattern 2: Budget Capped ───────────────────────

  private checkBudgetCapped(
    metrics: CampaignMetrics,
    evidence: MacroEvidence,
    currentBudget: number | null,
    breakEvenAcos: number,
    campaignId: string,
  ): MacroSuggestionDTO | null {
    if (!currentBudget || currentBudget <= 0) return null;

    const utilization = evidence.budgetUtilization ?? 0;
    const acos = metrics.strategic.acos ?? 0;
    const orders = metrics.strategic.orders ?? 0;

    if (
      utilization >= GATING.BUDGET_UTILIZATION_THRESHOLD &&
      acos > 0 &&
      acos <= breakEvenAcos * GATING.BUDGET_ACOS_MARGIN &&
      orders > 0
    ) {
      const newBudget = Math.round(currentBudget * (1 + GATING.BUDGET_INCREASE_PCT / 100) * 100) / 100;

      return {
        id: `macro-${campaignId}-budget-increase`,
        campaignId,
        title: 'Augmenter le budget quotidien',
        why: `Ta campagne atteint son budget presque chaque jour (${Math.round(utilization * 100)}%), mais elle est rentable (ACoS ${acos.toFixed(1)}%). Tu rates des ventes.`,
        bullets: [
          `Budget actuel : ${currentBudget.toFixed(2)} € / jour.`,
          `Suggestion : ${newBudget.toFixed(2)} € / jour (+${GATING.BUDGET_INCREASE_PCT}%).`,
          'Plus de budget = plus de visibilité = plus de ventes potentielles.',
        ],
        impactTag: 'accélérer',
        riskLevel: 'low',
        actionType: 'increase_budget',
        executable: true,
        current: { budget: currentBudget },
        recommended: { budget: newBudget },
        guardrails: {
          requiresConsent: true,
          consentLevel: 'basic',
        },
        evidence,
      };
    }

    return null;
  }

  // ── Pattern 3: Placement Mismatch ──────────────────

  private checkPlacementMismatch(
    metrics: CampaignMetrics,
    evidence: MacroEvidence,
    currentPlacements: PlacementAdjustments | null,
    campaignId: string,
  ): MacroSuggestionDTO | null {
    if (!currentPlacements) return null;
    if (currentPlacements.topOfSearch < GATING.PLACEMENT_MIN_MULTIPLIER) return null;

    const campaignAcos = metrics.strategic.acos ?? 0;
    const topAcos = metrics.topOfSearchAcos ?? 0;

    if (campaignAcos <= 0 || topAcos <= 0) return null;

    if (topAcos > campaignAcos * GATING.PLACEMENT_ACOS_RATIO) {
      const newTopOfSearch = Math.max(0, currentPlacements.topOfSearch - 20);

      return {
        id: `macro-${campaignId}-placement-mismatch`,
        campaignId,
        title: 'Ajuster les placements "Tête de recherche"',
        why: `L'ACoS en première page (${topAcos.toFixed(1)}%) est bien plus élevé que la moyenne de la campagne (${campaignAcos.toFixed(1)}%). Le bonus de placement coûte plus qu'il ne rapporte.`,
        bullets: [
          `Bonus actuel : +${currentPlacements.topOfSearch}% sur "Tête de recherche".`,
          `Suggestion : baisser à +${newTopOfSearch}%.`,
          'La visibilité en première page restera, mais sans la surenchère.',
        ],
        impactTag: 'réduire dépenses',
        riskLevel: 'low',
        actionType: 'update_placements',
        executable: true,
        current: { placements: currentPlacements },
        recommended: {
          placements: { ...currentPlacements, topOfSearch: newTopOfSearch },
        },
        guardrails: {
          requiresConsent: true,
          consentLevel: 'none',
        },
        evidence,
      };
    }

    return null;
  }

  // ── Pattern 4: Bidding Strategy Mismatch ───────────

  private checkBiddingMismatch(
    metrics: CampaignMetrics,
    evidence: MacroEvidence,
    currentBidding: BiddingStrategy,
    lifecyclePhase: LifecyclePhase,
    breakEvenAcos: number,
    campaignId: string,
  ): MacroSuggestionDTO | null {
    if (currentBidding !== 'up_and_down') return null;

    const totalClicks = metrics.strategic.clicks ?? 0;
    const acos = metrics.strategic.acos ?? 0;

    // Launch phase + up_and_down + insufficient data
    if (lifecyclePhase === 'launch' && totalClicks < GATING.BIDDING_LAUNCH_MIN_CLICKS) {
      return {
        id: `macro-${campaignId}-bidding-launch`,
        campaignId,
        title: 'Simplifier la stratégie d\'enchères',
        why: `En phase de lancement avec peu de données (${totalClicks} clics), la stratégie "Hausse et baisse" laisse Amazon prendre des décisions sans données fiables.`,
        bullets: [
          'La stratégie "Fixe" te donne un contrôle total sur les enchères.',
          'Avec si peu de clics, Amazon n\'a pas assez de données pour bien ajuster.',
          'Tu pourras passer en mode dynamique quand tu auras plus de données.',
        ],
        impactTag: 'protéger rentabilité',
        riskLevel: 'medium',
        actionType: 'set_bidding_strategy',
        executable: true,
        current: { biddingStrategy: currentBidding },
        recommended: { biddingStrategy: 'fixed' },
        guardrails: {
          requiresConsent: true,
          consentLevel: 'basic',
          cooldownDays: 7,
        },
        evidence,
      };
    }

    // Evergreen phase + up_and_down + unprofitable
    if (lifecyclePhase === 'evergreen' && acos > breakEvenAcos) {
      return {
        id: `macro-${campaignId}-bidding-evergreen`,
        campaignId,
        title: 'Passer en mode conservateur',
        why: `En régime de croisière, l'objectif est la rentabilité. Avec un ACoS de ${acos.toFixed(1)}% (au-dessus du seuil de ${breakEvenAcos}%), la stratégie "Hausse et baisse" est trop risquée.`,
        bullets: [
          'La stratégie "Baisses uniquement" empêche Amazon de surenchérir.',
          'Tes enchères ne monteront jamais automatiquement.',
          'Idéal pour protéger tes marges sur un livre bien installé.',
        ],
        impactTag: 'protéger rentabilité',
        riskLevel: 'medium',
        actionType: 'set_bidding_strategy',
        executable: true,
        current: { biddingStrategy: currentBidding },
        recommended: { biddingStrategy: 'down_only' },
        guardrails: {
          requiresConsent: true,
          consentLevel: 'basic',
          cooldownDays: 7,
        },
        evidence,
      };
    }

    return null;
  }

  // ── Data Loading ───────────────────────────────────

  private async loadCampaign(campaignId: string): Promise<any> {
    const result = await this.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    return result[0] || null;
  }

  private async loadCampaignMetrics(
    campaignId: string,
    strategicDays: number,
    trendDays: number,
  ): Promise<CampaignMetrics> {
    const entityKey = `campaign:${campaignId}`;

    // Strategic period metrics
    const strategicResult = await this.db.execute(sql`
      SELECT
        COALESCE(SUM(impressions), 0) as impressions,
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(orders), 0) as orders,
        COALESCE(SUM(spend), 0) as spend,
        COALESCE(SUM(sales), 0) as sales
      FROM ${dailyMetrics}
      WHERE entity_key = ${entityKey}
        AND entity_type = 'campaign'
        AND date >= CURRENT_DATE - ${strategicDays}::INTEGER * INTERVAL '1 day'
    `);
    const s = strategicResult.rows?.[0] || strategicResult[0] || {};

    // Trend period metrics (7 days)
    const trendResult = await this.db.execute(sql`
      SELECT
        COALESCE(SUM(impressions), 0) as impressions,
        COALESCE(SUM(clicks), 0) as clicks,
        COALESCE(SUM(orders), 0) as orders,
        COALESCE(SUM(spend), 0) as spend,
        COALESCE(SUM(sales), 0) as sales
      FROM ${dailyMetrics}
      WHERE entity_key = ${entityKey}
        AND entity_type = 'campaign'
        AND date >= CURRENT_DATE - ${trendDays}::INTEGER * INTERVAL '1 day'
    `);
    const t = trendResult.rows?.[0] || trendResult[0] || {};

    // Top of Search ACoS (from placement-level metrics if available)
    // For now, we'll try to extract from rawData in a future iteration
    // Placeholder: return undefined
    const topOfSearchAcos: number | undefined = undefined;

    return {
      strategic: {
        impressions: Number(s.impressions || 0),
        clicks: Number(s.clicks || 0),
        orders: Number(s.orders || 0),
        spend: Number(s.spend || 0),
        sales: Number(s.sales || 0),
        acos: Number(s.sales) > 0 ? (Number(s.spend) / Number(s.sales)) * 100 : 0,
        cvr: Number(s.clicks) > 0 ? (Number(s.orders) / Number(s.clicks)) * 100 : 0,
        dailySpend: strategicDays > 0 ? Number(s.spend) / strategicDays : 0,
      },
      trend: {
        impressions: Number(t.impressions || 0),
        clicks: Number(t.clicks || 0),
        orders: Number(t.orders || 0),
        spend: Number(t.spend || 0),
        sales: Number(t.sales || 0),
        acos: Number(t.sales) > 0 ? (Number(t.spend) / Number(t.sales)) * 100 : 0,
        cvr: Number(t.clicks) > 0 ? (Number(t.orders) / Number(t.clicks)) * 100 : 0,
        dailySpend: trendDays > 0 ? Number(t.spend) / trendDays : 0,
      },
      topOfSearchAcos,
    };
  }

  private async loadDiagnosticsDistribution(
    campaignId: string,
    bookId: string,
  ): Promise<{ counts: Record<string, number>; spendShareImpacted: number }> {
    // For now, return a simple approximation based on entity metrics
    // A more precise version would use the InsightsService entity insights
    // This placeholder gathers spend distribution from entities with degrading metrics

    const entityKey = `campaign:${campaignId}`;

    // Get total campaign spend
    const totalResult = await this.db.execute(sql`
      SELECT COALESCE(SUM(spend), 0) as total_spend
      FROM ${dailyMetrics}
      WHERE entity_key = ${entityKey}
        AND entity_type = 'campaign'
        AND date >= CURRENT_DATE - INTERVAL '7 days'
    `);
    const totalSpend = Number((totalResult.rows?.[0] || totalResult[0] || {}).total_spend || 0);

    if (totalSpend === 0) {
      return { counts: {}, spendShareImpacted: 0 };
    }

    // Get entity-level spend for keywords/targets with high ACoS
    // "impacted" = entities where 7-day ACoS > 14-day ACoS (degrading)
    const impactedResult = await this.db.execute(sql`
      WITH entity_metrics AS (
        SELECT
          entity_key,
          SUM(CASE WHEN date >= CURRENT_DATE - INTERVAL '7 days' THEN spend ELSE 0 END) as spend_7d,
          SUM(CASE WHEN date >= CURRENT_DATE - INTERVAL '7 days' THEN sales ELSE 0 END) as sales_7d,
          SUM(CASE WHEN date >= CURRENT_DATE - INTERVAL '14 days' THEN spend ELSE 0 END) as spend_14d,
          SUM(CASE WHEN date >= CURRENT_DATE - INTERVAL '14 days' THEN sales ELSE 0 END) as sales_14d
        FROM ${dailyMetrics}
        WHERE entity_type IN ('keyword', 'target')
          AND date >= CURRENT_DATE - INTERVAL '14 days'
          AND entity_key LIKE 'keyword:%' OR entity_key LIKE 'target:%'
        GROUP BY entity_key
        HAVING SUM(CASE WHEN date >= CURRENT_DATE - INTERVAL '7 days' THEN spend ELSE 0 END) > 0
      )
      SELECT COALESCE(SUM(spend_7d), 0) as impacted_spend
      FROM entity_metrics
      WHERE sales_7d > 0 AND sales_14d > 0
        AND (spend_7d / NULLIF(sales_7d, 0)) > (spend_14d / NULLIF(sales_14d, 0)) * 1.1
    `);
    const impactedSpend = Number((impactedResult.rows?.[0] || impactedResult[0] || {}).impacted_spend || 0);

    return {
      counts: {},
      spendShareImpacted: totalSpend > 0 ? impactedSpend / totalSpend : 0,
    };
  }

  // ── Helpers ────────────────────────────────────────

  private extractBiddingStrategy(campaign: any): BiddingStrategy {
    // Try rawData first, then column
    const rawData = campaign.rawData || {};
    const dynamicBidding = rawData.dynamicBidding || rawData.bidding || {};
    const strategy = dynamicBidding.strategy || campaign.biddingStrategy || '';

    const strategyMap: Record<string, BiddingStrategy> = {
      'LEGACY_FOR_SALES': 'up_and_down',
      'AUTO_FOR_SALES': 'up_and_down',
      'MANUAL': 'fixed',
      'RULE_BASED': 'down_only',
      // Direct values
      'up_and_down': 'up_and_down',
      'down_only': 'down_only',
      'fixed': 'fixed',
    };

    return strategyMap[strategy] || 'down_only';
  }

  private extractPlacements(campaign: any): PlacementAdjustments | null {
    const rawData = campaign.rawData || {};
    const dynamicBidding = rawData.dynamicBidding || {};
    const placementBidding = dynamicBidding.placementBidding || [];

    if (!Array.isArray(placementBidding) || placementBidding.length === 0) return null;

    const placements: PlacementAdjustments = {
      topOfSearch: 0,
      restOfSearch: 0,
      productPages: 0,
    };

    for (const p of placementBidding) {
      const percentage = p.percentage || 0;
      switch (p.placement) {
        case 'PLACEMENT_TOP':
          placements.topOfSearch = percentage;
          break;
        case 'PLACEMENT_REST_OF_SEARCH':
          placements.restOfSearch = percentage;
          break;
        case 'PLACEMENT_PRODUCT_PAGE':
          placements.productPages = percentage;
          break;
      }
    }

    return placements;
  }
}

// ── Internal Types ──────────────────────────────────

interface MetricsWindow {
  impressions: number;
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  acos: number;
  cvr: number;
  dailySpend: number;
}

interface CampaignMetrics {
  strategic: MetricsWindow;
  trend: MetricsWindow;
  topOfSearchAcos?: number;
}
