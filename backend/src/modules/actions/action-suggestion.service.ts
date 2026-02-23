import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, gte, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { keywords } from '@/db/schema/keywords';
import { productTargets } from '@/db/schema/product-targets';
import { dailyMetrics } from '@/db/schema/daily-metrics';
import { adGroups } from '@/db/schema/ad-groups';
import { campaigns } from '@/db/schema/campaigns';
import { marketplaceProfiles } from '@/db/schema/marketplace-profiles';
import { books } from '@/db/schema/books';
import { workspaces } from '@/db/schema/workspaces';
import { InsightsService } from '@/modules/insights/insights.service';
import { AmazonClientService } from '@/modules/amazon-client/amazon-client.service';
import { GUARDS } from '@/config/guards';
import { calculateRecommendedBid, type BidCalculationResult, type BidEligibility, type BidDirection } from './bid-calculator';
import { resolveDecisionWindow } from '@/modules/strategy/decision-window';
import type { ActionSuggestionDto } from './action-suggestion.dto';
import type { EntityDiagnosisCode, MetricsByWindow, WindowMetrics } from '@/modules/insights/types';
import type { LifecyclePhase } from '@/db/schema/books';
import type { Marketplace } from '@/config/amazon';

// ── Response Types ──────────────────────────────────────

export interface ActionSuggestionResponse {
  entityKey: string;
  entityType: 'keyword' | 'target';
  entityName: string;
  diagnosisCode: EntityDiagnosisCode;
  eligibility: BidEligibility;
  metrics: {
    impressions: number;
    clicks: number;
    orders: number;
    spend: number;
    sales: number;
    acos: number | null;
    ctr: number | null;
    cvr: number | null;
    periodDays: number;
  };
  currentBid: number;
  bidCalculation: BidCalculationResult;
  amazonBid?: {
    suggested: number;
    rangeMin: number;
    rangeMax: number;
  };
  availableActions: Array<{
    type: 'adjust_bid' | 'pause';
    enabled: boolean;
    reason?: string;
  }>;
}

// ── Service ─────────────────────────────────────────────

@Injectable()
export class ActionSuggestionService {
  private readonly logger = new Logger(ActionSuggestionService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
    private configService: ConfigService,
    private insightsService: InsightsService,
    private amazonClient: AmazonClientService,
  ) {}

  async getActionSuggestion(dto: ActionSuggestionDto): Promise<ActionSuggestionResponse> {
    const { workspaceId, entityKey, entityType, acosTarget, lifecyclePhase } = dto;

    // 1. Charger l'entité depuis la DB
    const entity = await this.loadEntity(workspaceId, entityKey, entityType);
    if (!entity) {
      throw new NotFoundException(`Entity ${entityKey} not found`);
    }

    // 2. Calculer la période stratégique + multi-window
    const phase: LifecyclePhase = (lifecyclePhase || 'evergreen') as LifecyclePhase;

    // 3. Charger les métriques sur 30j (max window) et slicer en mémoire
    const metrics30d = await this.loadEntityMetrics(workspaceId, entityKey, entityType, 30);
    const metrics14d = await this.loadEntityMetrics(workspaceId, entityKey, entityType, 14);
    const metrics7d = await this.loadEntityMetrics(workspaceId, entityKey, entityType, 7);

    const metricsByWindow: MetricsByWindow = {
      window_7d: { ...metrics7d, units: 0, acos: null, ctr: null, cvr: null },
      window_14d: { ...metrics14d, units: 0, acos: null, ctr: null, cvr: null },
      window_30d: { ...metrics30d, units: 0, acos: null, ctr: null, cvr: null },
    };

    // Resolve optimal decision window
    const dwResult = resolveDecisionWindow(phase, metricsByWindow);
    const metrics = dwResult.metricsOnWindow;
    const strategicDays = dwResult.chosenWindow;

    // 4. Obtenir le diagnostic
    const breakEvenAcos = acosTarget; // ACoS cible = break-even dans ce contexte
    const diagnosisCode = this.insightsService.diagnoseEntity(metrics, breakEvenAcos);

    // 5. Fetch Amazon bid recommendations via v4 theme-based endpoint (seul endpoint actif depuis mai 2025)
    // Keywords → {type: "KEYWORD_EXACT_MATCH", value: "mot clé"}
    // Product targets → {type: "asinSameAs", value: "B0..."} (camelCase natif Amazon)
    let amazonBid: ActionSuggestionResponse['amazonBid'] | undefined;
    if (entity.adAccountId && entity.profileId && entity.amazonCampaignId && entity.amazonAdGroupId) {
      try {
        const targetingExpression = entityType === 'keyword'
          ? this.buildKeywordTargetingExpression(entity)
          : this.buildProductTargetExpression(entity);

        if (targetingExpression) {
          this.logger.log(
            `[BID-RECO] Will request bid for ${entityType}: ` +
            `campaign=${entity.amazonCampaignId} adGroup=${entity.amazonAdGroupId} ` +
            `expression=${JSON.stringify(targetingExpression)} strategy=${entity.biddingStrategy || 'LEGACY_FOR_SALES'}`,
          );

          const rec = await this.amazonClient.getThemeBasedBidRecommendation(
            entity.adAccountId,
            entity.profileId,
            entity.marketplace as Marketplace,
            {
              campaignId: entity.amazonCampaignId,
              adGroupId: entity.amazonAdGroupId,
              targetingExpression,
              strategy: entity.biddingStrategy || 'LEGACY_FOR_SALES',
            },
          );
          if (rec) amazonBid = rec;
        } else {
          this.logger.warn(`[BID-RECO] Could not build targeting expression for ${entityType}: ${JSON.stringify({ matchType: entity.matchType, keywordText: entity.keywordText, expressionType: entity.expressionType })}`);
        }
      } catch (err) {
        this.logger.warn(`Amazon bid recommendations failed: ${err.message}`);
      }
    } else {
      this.logger.warn(`[BID-RECO] Missing required fields: adAccountId=${entity.adAccountId} profileId=${entity.profileId} campaignId=${entity.amazonCampaignId} adGroupId=${entity.amazonAdGroupId}`);
    }

    // 6. Calculer le bid recommandé
    const cvr = metrics.clicks > 0 ? metrics.orders / metrics.clicks : 0;
    const aov = metrics.orders > 0 ? metrics.sales / metrics.orders : 0;
    const acosDecimal = acosTarget / 100; // convertir % → décimal

    // Déterminer la direction forcée basée sur le diagnostic
    const bidDirection = this.diagnosisToBidDirection(diagnosisCode);

    const bidCalculation = calculateRecommendedBid({
      currentBid: entity.bid,
      acosTarget: acosDecimal,
      cvr,
      aov,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      orders: metrics.orders,
      spend: metrics.spend,
      sales: metrics.sales,
      amazonSuggestedBid: amazonBid?.suggested,
      amazonBidRangeMin: amazonBid?.rangeMin,
      amazonBidRangeMax: amazonBid?.rangeMax,
      direction: bidDirection,
    });

    // 7. Déterminer les actions disponibles
    const isProfitable = metrics.orders >= 1 && metrics.sales > metrics.spend;
    const availableActions = this.buildAvailableActions(bidCalculation.eligibility, isProfitable, diagnosisCode);

    // 8. Construire les métriques de sortie
    const acos = metrics.sales > 0 ? (metrics.spend / metrics.sales) * 100 : null;
    const ctr = metrics.impressions > 0 ? (metrics.clicks / metrics.impressions) * 100 : null;
    const cvrPercent = metrics.clicks > 0 ? (metrics.orders / metrics.clicks) * 100 : null;

    return {
      entityKey,
      entityType,
      entityName: entity.name,
      diagnosisCode,
      eligibility: bidCalculation.eligibility,
      metrics: {
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        orders: metrics.orders,
        spend: metrics.spend,
        sales: metrics.sales,
        acos: acos !== null ? Math.round(acos * 10) / 10 : null,
        ctr: ctr !== null ? Math.round(ctr * 100) / 100 : null,
        cvr: cvrPercent !== null ? Math.round(cvrPercent * 10) / 10 : null,
        periodDays: strategicDays,
      },
      currentBid: entity.bid,
      bidCalculation,
      amazonBid,
      availableActions,
    };
  }

  // ── Helpers privés ──────────────────────────────────────

  private buildAvailableActions(
    eligibility: BidEligibility,
    isProfitable: boolean,
    diagnosisCode: EntityDiagnosisCode,
  ): ActionSuggestionResponse['availableActions'] {
    const actions: ActionSuggestionResponse['availableActions'] = [];

    // adjust_bid
    if (eligibility === 'insufficient_data') {
      actions.push({ type: 'adjust_bid', enabled: false, reason: 'Pas assez de données (< 5 clics)' });
    } else if (eligibility === 'observe_only') {
      actions.push({ type: 'adjust_bid', enabled: false, reason: 'Phase d\'observation' });
    } else {
      actions.push({ type: 'adjust_bid', enabled: true });
    }

    // pause
    if (isProfitable) {
      actions.push({ type: 'pause', enabled: false, reason: 'Entité rentable — pause déconseillée' });
    } else if (eligibility === 'insufficient_data') {
      actions.push({ type: 'pause', enabled: false, reason: 'Pas assez de données pour justifier une pause' });
    } else {
      actions.push({ type: 'pause', enabled: true });
    }

    return actions;
  }

  private async loadEntity(
    workspaceId: string,
    entityKey: string,
    entityType: 'keyword' | 'target',
  ): Promise<{
    name: string;
    bid: number;
    state: string;
    amazonEntityId: number;
    adAccountId?: string;
    profileId?: number;
    marketplace?: string;
    amazonCampaignId?: number;
    amazonAdGroupId?: number;
    biddingStrategy?: string;
    matchType?: string;
    keywordText?: string;
    expressionType?: string;
    expression?: any;
  } | null> {
    const amazonId = this.extractAmazonId(entityKey);
    if (amazonId === null) return null;

    if (entityType === 'keyword') {
      const rows = await this.db
        .select({
          name: keywords.keywordText,
          bid: keywords.bid,
          state: keywords.state,
          amazonEntityId: keywords.amazonKeywordId,
          matchType: keywords.matchType,
          adAccountId: marketplaceProfiles.adAccountId,
          profileId: marketplaceProfiles.profileId,
          marketplace: marketplaceProfiles.marketplace,
          amazonCampaignId: campaigns.amazonCampaignId,
          amazonAdGroupId: adGroups.amazonAdGroupId,
          biddingStrategy: campaigns.biddingStrategy,
        })
        .from(keywords)
        .innerJoin(adGroups, eq(keywords.adGroupId, adGroups.id))
        .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
        .innerJoin(marketplaceProfiles, eq(campaigns.profileId, marketplaceProfiles.id))
        .where(eq(keywords.amazonKeywordId, amazonId))
        .limit(1);

      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        name: r.name,
        bid: Number(r.bid) || 0,
        state: r.state,
        amazonEntityId: r.amazonEntityId,
        adAccountId: r.adAccountId,
        profileId: r.profileId,
        marketplace: r.marketplace,
        amazonCampaignId: r.amazonCampaignId,
        amazonAdGroupId: r.amazonAdGroupId,
        biddingStrategy: r.biddingStrategy ?? undefined,
        matchType: r.matchType,
        keywordText: r.name,
      };
    }

    // target
    const rows = await this.db
      .select({
        expressionType: productTargets.expressionType,
        expression: productTargets.expression,
        bid: productTargets.bid,
        state: productTargets.state,
        amazonEntityId: productTargets.amazonTargetId,
        adAccountId: marketplaceProfiles.adAccountId,
        profileId: marketplaceProfiles.profileId,
        marketplace: marketplaceProfiles.marketplace,
        amazonCampaignId: campaigns.amazonCampaignId,
        amazonAdGroupId: adGroups.amazonAdGroupId,
        biddingStrategy: campaigns.biddingStrategy,
      })
      .from(productTargets)
      .innerJoin(adGroups, eq(productTargets.adGroupId, adGroups.id))
      .innerJoin(campaigns, eq(adGroups.campaignId, campaigns.id))
      .innerJoin(marketplaceProfiles, eq(campaigns.profileId, marketplaceProfiles.id))
      .where(eq(productTargets.amazonTargetId, amazonId))
      .limit(1);

    if (rows.length === 0) return null;
    const r = rows[0];
    const expressionText = typeof r.expression === 'object'
      ? JSON.stringify(r.expression)
      : String(r.expression || r.expressionType);

    return {
      name: expressionText,
      bid: Number(r.bid) || 0,
      state: r.state,
      amazonEntityId: r.amazonEntityId,
      adAccountId: r.adAccountId,
      profileId: r.profileId,
      marketplace: r.marketplace,
      amazonCampaignId: r.amazonCampaignId,
      amazonAdGroupId: r.amazonAdGroupId,
      biddingStrategy: r.biddingStrategy ?? undefined,
      expressionType: r.expressionType,
      expression: r.expression,
    };
  }

  private async loadEntityMetrics(
    workspaceId: string,
    entityKey: string,
    entityType: 'keyword' | 'target',
    days: number,
  ): Promise<{
    impressions: number;
    clicks: number;
    orders: number;
    spend: number;
    sales: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    const rows = await this.db
      .select({
        impressions: sql<number>`COALESCE(SUM(${dailyMetrics.impressions}), 0)`,
        clicks: sql<number>`COALESCE(SUM(${dailyMetrics.clicks}), 0)`,
        orders: sql<number>`COALESCE(SUM(${dailyMetrics.orders}), 0)`,
        spend: sql<number>`COALESCE(SUM(${dailyMetrics.spend}::numeric), 0)`,
        sales: sql<number>`COALESCE(SUM(${dailyMetrics.sales}::numeric), 0)`,
      })
      .from(dailyMetrics)
      .where(
        and(
          eq(dailyMetrics.entityKey, entityKey),
          eq(dailyMetrics.entityType, entityType),
          eq(dailyMetrics.workspaceId, workspaceId),
          gte(dailyMetrics.date, startDateStr),
        ),
      );

    const r = rows[0] || {};
    return {
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      orders: Number(r.orders) || 0,
      spend: Number(r.spend) || 0,
      sales: Number(r.sales) || 0,
    };
  }

  /**
   * Détermine la direction de bid forcée à partir du diagnostic.
   * - CLICKS_NO_SALES, EXPENSIVE_BUT_VALID → 'down' (baisser)
   * - WINNER, BOOST_CANDIDATE → 'up' (monter)
   * - Autres → null (pas de direction forcée, la formule décide)
   */
  private diagnosisToBidDirection(diagnosisCode: EntityDiagnosisCode): BidDirection {
    switch (diagnosisCode) {
      case 'clicks_no_sales':
      case 'expensive_but_valid':
        return 'down';
      case 'winner':
      case 'boost_candidate':
        return 'up';
      default:
        return null;
    }
  }

  /**
   * Construit la targetingExpression pour l'API v4 theme-based (keywords).
   * Format: {type: "KEYWORD_EXACT_MATCH", value: "mot clé"}
   */
  private buildKeywordTargetingExpression(
    entity: { matchType?: string; keywordText?: string },
  ): { type: string; value?: string } | null {
    if (!entity.matchType || !entity.keywordText) return null;

    const matchTypeMap: Record<string, string> = {
      exact: 'KEYWORD_EXACT_MATCH',
      phrase: 'KEYWORD_PHRASE_MATCH',
      broad: 'KEYWORD_BROAD_MATCH',
    };
    const amazonType = matchTypeMap[entity.matchType.toLowerCase()];
    if (!amazonType) {
      this.logger.warn(`Unknown keyword matchType: ${entity.matchType}`);
      return null;
    }

    return { type: amazonType, value: entity.keywordText };
  }

  /**
   * Construit la targetingExpression pour l'API v4 theme-based (product targets).
   * Format camelCase natif Amazon: {type: "asinSameAs", value: "B0DPVHT7Y3"}
   * Le v4 accepte les types camelCase pour product targeting.
   */
  private buildProductTargetExpression(
    entity: { expressionType?: string; expression?: any },
  ): { type: string; value?: string } | null {
    // Le champ expression en DB est le format brut Amazon : [{type: "asinSameAs", value: "B0..."}]
    if (Array.isArray(entity.expression) && entity.expression.length > 0) {
      const expr = entity.expression[0];
      if (expr && expr.type) {
        return { type: expr.type, value: expr.value };
      }
    }

    // Fallback: si expression est une string (ex: un ASIN brut)
    if (typeof entity.expression === 'string' && entity.expression.length > 0) {
      return { type: 'asinSameAs', value: entity.expression };
    }

    // Dernier recours: utiliser expressionType s'il existe
    if (entity.expressionType && entity.expressionType !== 'manual') {
      return { type: entity.expressionType };
    }

    return null;
  }

  private extractAmazonId(entityKey: string): number | null {
    // entityKey format: 'keyword:12345' ou 'target:67890'
    const parts = entityKey.split(':');
    if (parts.length < 2) return null;
    const id = parseInt(parts[1], 10);
    return isNaN(id) ? null : id;
  }
}
