import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import {
  books,
  campaigns,
  campaignBookMapping,
  adGroups,
  keywords,
  productTargets,
  dailyMetrics,
} from '@/db/schema';
import { eq, and, inArray, gte, lte } from 'drizzle-orm';
import { InsightsService } from '@/modules/insights/insights.service';
import { LifecycleService } from '@/modules/lifecycle/lifecycle.service';
import { GUARDS } from '@/config/guards';

import { StructureAnalyzerService } from './services/structure-analyzer.service';
import { CampaignClassifierService } from './services/campaign-classifier.service';
import { ScenarioSelectorService } from './services/scenario-selector.service';
import { MaturityScorerService } from './services/maturity-scorer.service';
import { RoadmapGeneratorService } from './services/roadmap-generator.service';
import { TopFocusService } from './services/top-focus.service';
import { GapDetectorService } from './services/gap-detector.service';
import { HarvestService } from './services/harvest.service';

import type {
  CampaignEvolutionResult,
  CampaignGraph,
  CampaignWithEntities,
  BookContext,
  EntityInsight,
  CampaignMacroStrategy,
  InsightMetrics,
  ScenarioContext,
  EvolutionContext,
  TopFocusContext,
  StructuralGap,
  LifecycleDetection,
  CreationPlanResponse,
  CreationMode,
} from './campaign-evolution.types';

@Injectable()
export class CampaignEvolutionService {
  private readonly logger = new Logger(CampaignEvolutionService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly insightsService: InsightsService,
    private readonly lifecycleService: LifecycleService,
    private readonly structureAnalyzer: StructureAnalyzerService,
    private readonly campaignClassifier: CampaignClassifierService,
    private readonly scenarioSelector: ScenarioSelectorService,
    private readonly maturityScorer: MaturityScorerService,
    private readonly roadmapGenerator: RoadmapGeneratorService,
    private readonly topFocusService: TopFocusService,
    private readonly gapDetector: GapDetectorService,
    private readonly harvestService: HarvestService,
  ) {}

  // ── Main Entry Point ──────────────────────────────────────────

  async analyzeBookEvolution(
    bookId: string,
    workspaceId: string,
  ): Promise<CampaignEvolutionResult> {
    this.logger.log(`Analyzing evolution for book ${bookId}`);

    // 1. Load book context
    const bookContext = await this.loadBookContext(bookId);

    // 2. Load campaign graph (campaigns + ad groups + keywords + targets)
    const graph = await this.loadCampaignGraph(bookId);
    const activeCampaigns = graph.campaigns.filter((c) => c.state !== 'archived');

    // 3. Load entity diagnostics via InsightsService
    const { entityInsightsMap, macroStrategies } = await this.loadDiagnostics(
      activeCampaigns,
      bookContext,
    );

    // 4. Structure analysis
    const duplicationScore = this.structureAnalyzer.computeDuplicationScore(activeCampaigns);
    const chaosScore = this.structureAnalyzer.computeChaosScore(activeCampaigns);
    const namingConsistency = this.structureAnalyzer.namingConsistencyComponent(
      activeCampaigns.map((c) => c.name),
    );

    // 5. Campaign classification
    const campaignRoles = this.campaignClassifier.classifyCampaigns(
      activeCampaigns,
      entityInsightsMap,
      macroStrategies,
    );

    // 6. Collect winner keywords for issue detection
    const winnerKeywords: string[] = [];
    for (const [, insights] of entityInsightsMap) {
      for (const insight of insights) {
        if (insight.diagnosisCode === 'winner') {
          winnerKeywords.push(insight.entityKey);
        }
      }
    }

    // 7. Structural issues
    const structuralIssues = this.structureAnalyzer.detectStructuralIssues(
      activeCampaigns,
      duplicationScore,
      chaosScore,
      campaignRoles,
      winnerKeywords,
    );

    // 8. Scenario selection
    const scenario = this.scenarioSelector.selectScenario(
      activeCampaigns,
      duplicationScore,
      chaosScore,
      entityInsightsMap,
    );

    // 9. Build scenario context
    const scenarioCtx: ScenarioContext = {
      bookContext,
      campaigns: activeCampaigns,
      entityInsightsMap,
      macroStrategies,
      duplicationScore,
      chaosScore,
      campaignRoles,
    };

    // 10. Suggestions
    const suggestions = this.scenarioSelector.generateSuggestions(scenarioCtx);

    // 11. Next campaign recommendations
    const nextCampaignRecommendations = this.scenarioSelector.generateNextCampaignRecommendations(
      scenario,
      scenarioCtx,
    );

    // 12. Diversification opportunities
    const diversificationOpportunities = this.scenarioSelector.generateDiversificationOpportunities(
      scenarioCtx,
    );

    // 13. Maturity score
    const maturity = this.maturityScorer.computeMaturityScore(
      activeCampaigns,
      campaignRoles,
      entityInsightsMap,
      duplicationScore,
      chaosScore,
      namingConsistency,
    );

    // 14. Context stats (enriched with spend/sales)
    const context = this.buildContext(activeCampaigns, entityInsightsMap, bookContext);

    // 15. Gap Detection (before TopFocus and Roadmap so they can use gaps)
    const topFocusCtx: TopFocusContext = {
      scenario,
      bookContext,
      campaigns: activeCampaigns,
      entityInsightsMap,
      duplicationScore,
      chaosScore,
      campaignRoles,
      maturityScore: maturity.total,
      context,
      gaps: [], // will be filled below
    };

    const gaps = this.gapDetector.detectGaps(topFocusCtx);
    topFocusCtx.gaps = gaps;

    // 16. Roadmap (now with gaps + entityInsightsMap)
    const roadmap = this.roadmapGenerator.generateRoadmap({
      scenario,
      bookContext,
      suggestions,
      campaigns: activeCampaigns,
      campaignRoles,
      entityInsightsMap,
      gaps,
    });

    // 17. Top Focus + Creation Plan (gap-aware, with harvest data)
    const harvestedAssets = this.harvestService.harvest(topFocusCtx);
    const topFocus = this.topFocusService.computeTopFocus(topFocusCtx);
    const creationPlan = this.topFocusService.generateCreationPlan(topFocusCtx, harvestedAssets);

    // Link planId to CTA if plan exists
    if (creationPlan && topFocus.primaryCta.intent === 'CREATE') {
      topFocus.primaryCta.planId = creationPlan.planId;
    }

    // 18. Lifecycle detection (enriched)
    const lifecycleDetected = await this.detectLifecycle(bookId, bookContext);

    return {
      bookId,
      analyzedAt: new Date().toISOString(),
      maturityScore: maturity.total,
      maturityBreakdown: {
        structure: maturity.structure,
        winnersExploited: maturity.winnersExploited,
        diversification: maturity.diversification,
        stability: maturity.stability,
      },
      duplicationScore: Math.round(duplicationScore * 100) / 100,
      chaosScore: Math.round(chaosScore * 100) / 100,
      scenario,
      topFocus,
      creationPlan,
      gaps,
      lifecycleDetected,
      campaignRoles,
      structuralIssues,
      suggestions,
      roadmap,
      nextCampaignRecommendations,
      diversificationOpportunities,
      context,
    };
  }

  // ── Lifecycle Detection ────────────────────────────────────────

  private async detectLifecycle(bookId: string, bookContext: BookContext): Promise<LifecycleDetection> {
    try {
      const result = await this.lifecycleService.computePhase(bookId);
      const evidence: Record<string, any> = result.evidence || {};

      // Compute confidence from evidence strength
      let confidence = 0.6; // base
      if (evidence.daysSincePublish !== undefined) {
        if (evidence.daysSincePublish > 180 && result.phase === 'evergreen') confidence += 0.2;
        if (evidence.daysSincePublish < 30 && result.phase === 'launch') confidence += 0.2;
        if (evidence.daysSincePublish >= 30 && evidence.daysSincePublish <= 180 && result.phase === 'scale') confidence += 0.15;
      }
      if (evidence.ordersTotal30d !== undefined && evidence.ordersTotal30d > 10) confidence += 0.1;
      confidence = Math.min(confidence, 1.0);

      return {
        phase: result.phase,
        confidence: Math.round(confidence * 100) / 100,
        reasonBullets: result.explanation || [],
      };
    } catch (err) {
      this.logger.warn(`Lifecycle detection failed for book ${bookId}: ${err}`);
      return {
        phase: bookContext.lifecyclePhase || 'launch',
        confidence: 0.5,
        reasonBullets: ['Phase déterminée à partir du profil du livre'],
      };
    }
  }

  // ── On-demand Creation Plan ───────────────────────────────────

  async generateCreationPlan(
    bookId: string,
    workspaceId: string,
    lifecyclePhaseOverride?: string,
    forceRebuild?: boolean,
    mode?: CreationMode,
  ): Promise<CreationPlanResponse> {
    const effectiveMode: CreationMode = mode || 'HARVEST';
    this.logger.log(`Generating creation plan for book ${bookId} (override=${lifecyclePhaseOverride}, mode=${effectiveMode})`);

    // 1. Load book context
    const bookContext = await this.loadBookContext(bookId);
    if (lifecyclePhaseOverride) {
      bookContext.lifecyclePhase = lifecyclePhaseOverride;
    }

    // 2. Load campaign graph + diagnostics
    const graph = await this.loadCampaignGraph(bookId);
    const activeCampaigns = graph.campaigns.filter(c => c.state !== 'archived');
    const { entityInsightsMap, macroStrategies } = await this.loadDiagnostics(activeCampaigns, bookContext);

    // 3. Structure analysis
    const duplicationScore = this.structureAnalyzer.computeDuplicationScore(activeCampaigns);
    const chaosScore = this.structureAnalyzer.computeChaosScore(activeCampaigns);

    // 4. Campaign classification
    const campaignRoles = this.campaignClassifier.classifyCampaigns(activeCampaigns, entityInsightsMap, macroStrategies);

    // 5. Maturity
    const namingConsistency = this.structureAnalyzer.namingConsistencyComponent(activeCampaigns.map(c => c.name));
    const maturity = this.maturityScorer.computeMaturityScore(activeCampaigns, campaignRoles, entityInsightsMap, duplicationScore, chaosScore, namingConsistency);

    // 6. Context + scenario
    const context = this.buildContext(activeCampaigns, entityInsightsMap, bookContext);
    const scenario = this.scenarioSelector.selectScenario(activeCampaigns, duplicationScore, chaosScore, entityInsightsMap);

    // 7. Build TopFocusContext
    const topFocusCtx: TopFocusContext = {
      scenario,
      bookContext,
      campaigns: activeCampaigns,
      entityInsightsMap,
      duplicationScore,
      chaosScore,
      campaignRoles,
      maturityScore: maturity.total,
      context,
      gaps: [],
    };

    // 8. Detect gaps (informational only — no longer drive creation)
    const gaps = this.gapDetector.detectGaps(topFocusCtx);
    topFocusCtx.gaps = gaps;

    // 9. Harvest assets (used by HARVEST mode, partially by RESET for userProvidedKeywords)
    const harvestedAssets = await this.harvestService.harvestAsync(topFocusCtx);

    // 10. Generate creation plan based on user-selected mode
    const creationPlan = this.topFocusService.generateCreationPlanForMode(
      topFocusCtx,
      harvestedAssets,
      effectiveMode,
    );

    // 11. Roadmap (for informational display)
    const suggestions = this.scenarioSelector.generateSuggestions({
      bookContext, campaigns: activeCampaigns, entityInsightsMap, macroStrategies, duplicationScore, chaosScore, campaignRoles,
    });
    const roadmap = this.roadmapGenerator.generateRoadmap({
      scenario, bookContext, suggestions, campaigns: activeCampaigns, campaignRoles, entityInsightsMap, gaps,
    });

    return {
      creationPlan,
      roadmap,
      gaps,
      harvestedAssets,
      lifecycleUsed: bookContext.lifecyclePhase,
      modeUsed: effectiveMode,
    };
  }

  // ── Data Loading ──────────────────────────────────────────────

  private async loadBookContext(bookId: string): Promise<BookContext> {
    const [book] = await this.db.select().from(books).where(eq(books.id, bookId)).limit(1);
    if (!book) throw new NotFoundException(`Book ${bookId} not found`);

    return {
      id: book.id,
      title: book.title,
      asin: book.asin,
      lifecyclePhase: book.lifecyclePhase || book.lifecyclePhaseOverride || 'launch',
      acosTarget: book.acosTarget ? Number(book.acosTarget) : GUARDS.DEFAULT_ACOS_TARGET,
      royaltyPerUnit: book.royaltyPerUnit ? Number(book.royaltyPerUnit) : null,
      salePrice: book.salePrice ? Number(book.salePrice) : null,
    };
  }

  private async loadCampaignGraph(bookId: string): Promise<CampaignGraph> {
    const mappings = await this.db
      .select({ campaignId: campaignBookMapping.campaignId })
      .from(campaignBookMapping)
      .where(eq(campaignBookMapping.bookId, bookId));

    const campaignIds = mappings.map((m: any) => m.campaignId);
    if (campaignIds.length === 0) return { campaigns: [] };

    const allCampaigns = await this.db
      .select()
      .from(campaigns)
      .where(inArray(campaigns.id, campaignIds));

    const allAdGroups = await this.db
      .select()
      .from(adGroups)
      .where(inArray(adGroups.campaignId, campaignIds));

    const adGroupIds = allAdGroups.map((ag: any) => ag.id);

    const [allKeywords, allTargets] = await Promise.all([
      adGroupIds.length > 0
        ? this.db.select().from(keywords).where(inArray(keywords.adGroupId, adGroupIds))
        : [],
      adGroupIds.length > 0
        ? this.db.select().from(productTargets).where(inArray(productTargets.adGroupId, adGroupIds))
        : [],
    ]);

    const agsByCampaign = new Map<string, any[]>();
    for (const ag of allAdGroups) {
      if (!agsByCampaign.has(ag.campaignId)) agsByCampaign.set(ag.campaignId, []);
      agsByCampaign.get(ag.campaignId)!.push(ag);
    }

    const kwsByAdGroup = new Map<string, any[]>();
    for (const kw of allKeywords) {
      if (!kwsByAdGroup.has(kw.adGroupId)) kwsByAdGroup.set(kw.adGroupId, []);
      kwsByAdGroup.get(kw.adGroupId)!.push(kw);
    }

    const tgsByAdGroup = new Map<string, any[]>();
    for (const tg of allTargets) {
      if (!tgsByAdGroup.has(tg.adGroupId)) tgsByAdGroup.set(tg.adGroupId, []);
      tgsByAdGroup.get(tg.adGroupId)!.push(tg);
    }

    const result: CampaignWithEntities[] = allCampaigns.map((c: any) => {
      const campaignAgs = agsByCampaign.get(c.id) || [];
      return {
        id: c.id,
        name: c.name,
        campaignType: c.campaignType,
        targetingType: c.targetingType,
        state: c.state,
        dailyBudget: c.dailyBudget ? Number(c.dailyBudget) : null,
        startDate: c.startDate,
        adGroups: campaignAgs.map((ag: any) => ({
          id: ag.id,
          name: ag.name,
          state: ag.state,
          defaultBid: ag.defaultBid ? Number(ag.defaultBid) : null,
          keywords: (kwsByAdGroup.get(ag.id) || []).map((kw: any) => ({
            id: kw.id,
            amazonKeywordId: kw.amazonKeywordId,
            keywordText: kw.keywordText,
            matchType: kw.matchType,
            state: kw.state,
            bid: kw.bid ? Number(kw.bid) : null,
          })),
          targets: (tgsByAdGroup.get(ag.id) || []).map((tg: any) => ({
            id: tg.id,
            amazonTargetId: tg.amazonTargetId,
            expressionType: tg.expressionType,
            expression: tg.expression,
            state: tg.state,
            bid: tg.bid ? Number(tg.bid) : null,
          })),
        })),
      };
    });

    return { campaigns: result };
  }

  private async loadDiagnostics(
    activeCampaigns: CampaignWithEntities[],
    bookContext: BookContext,
  ): Promise<{
    entityInsightsMap: Map<string, EntityInsight[]>;
    macroStrategies: Map<string, CampaignMacroStrategy>;
  }> {
    const entityInsightsMap = new Map<string, EntityInsight[]>();
    const macroStrategies = new Map<string, CampaignMacroStrategy>();

    const breakEvenAcos = bookContext.acosTarget;
    const lifecyclePhase = bookContext.lifecyclePhase as any;
    const periodDays = GUARDS.STRATEGIC_PERIOD_BY_PHASE[lifecyclePhase] || 14;

    const allEntityKeys: string[] = [];
    const entityKeyToCampaign = new Map<string, string>();

    for (const campaign of activeCampaigns) {
      for (const ag of campaign.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state === 'archived') continue;
          const key = `keyword:${kw.id}`;
          allEntityKeys.push(key);
          entityKeyToCampaign.set(key, campaign.id);
        }
        for (const tg of ag.targets) {
          if (tg.state === 'archived') continue;
          const key = `target:${tg.id}`;
          allEntityKeys.push(key);
          entityKeyToCampaign.set(key, campaign.id);
        }
      }
    }

    if (allEntityKeys.length === 0) {
      for (const campaign of activeCampaigns) {
        entityInsightsMap.set(campaign.id, []);
        const macro = this.insightsService.getCampaignMacroStrategy([]);
        macroStrategies.set(campaign.id, macro);
      }
      return { entityInsightsMap, macroStrategies };
    }

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - periodDays * 86400000).toISOString().split('T')[0];

    const rawRows = await this.db
      .select({
        entityKey: dailyMetrics.entityKey,
        impressions: dailyMetrics.impressions,
        clicks: dailyMetrics.clicks,
        spend: dailyMetrics.spend,
        sales: dailyMetrics.sales,
        orders: dailyMetrics.orders,
      })
      .from(dailyMetrics)
      .where(
        and(
          inArray(dailyMetrics.entityKey, allEntityKeys),
          gte(dailyMetrics.date, startDate),
          lte(dailyMetrics.date, endDate),
        ),
      );

    const metricsByKey = new Map<string, InsightMetrics>();
    for (const row of rawRows) {
      const existing = metricsByKey.get(row.entityKey) || {
        impressions: 0,
        clicks: 0,
        spend: 0,
        sales: 0,
        orders: 0,
      };
      existing.impressions += Number(row.impressions || 0);
      existing.clicks += Number(row.clicks || 0);
      existing.spend += Number(row.spend || 0);
      existing.sales += Number(row.sales || 0);
      existing.orders += Number(row.orders || 0);
      metricsByKey.set(row.entityKey, existing);
    }

    const insightsByEntity = new Map<string, EntityInsight>();
    for (const campaign of activeCampaigns) {
      for (const ag of campaign.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state === 'archived') continue;
          const key = `keyword:${kw.id}`;
          const metrics = metricsByKey.get(key) || { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
          const insight = this.insightsService.computeEntityInsight(
            { key, type: 'keyword', name: kw.keywordText, campaignId: campaign.id, campaignName: campaign.name },
            metrics,
            lifecyclePhase,
            breakEvenAcos,
            periodDays,
          );
          insightsByEntity.set(key, insight);
        }
        for (const tg of ag.targets) {
          if (tg.state === 'archived') continue;
          const key = `target:${tg.id}`;
          const metrics = metricsByKey.get(key) || { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
          const insight = this.insightsService.computeEntityInsight(
            { key, type: 'target', name: `target:${tg.amazonTargetId}`, campaignId: campaign.id, campaignName: campaign.name },
            metrics,
            lifecyclePhase,
            breakEvenAcos,
            periodDays,
          );
          insightsByEntity.set(key, insight);
        }
      }
    }

    for (const campaign of activeCampaigns) {
      const campaignInsights: EntityInsight[] = [];
      for (const ag of campaign.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state === 'archived') continue;
          const key = `keyword:${kw.id}`;
          const insight = insightsByEntity.get(key);
          if (insight) campaignInsights.push(insight);
        }
        for (const tg of ag.targets) {
          if (tg.state === 'archived') continue;
          const key = `target:${tg.id}`;
          const insight = insightsByEntity.get(key);
          if (insight) campaignInsights.push(insight);
        }
      }

      entityInsightsMap.set(campaign.id, campaignInsights);
      const macro = this.insightsService.getCampaignMacroStrategy(campaignInsights);
      macroStrategies.set(campaign.id, macro);
    }

    return { entityInsightsMap, macroStrategies };
  }

  // ── Context Builder (enriched) ─────────────────────────────────

  private buildContext(
    campaigns: CampaignWithEntities[],
    entityInsightsMap: Map<string, EntityInsight[]>,
    bookContext: BookContext,
  ): EvolutionContext {
    let totalKeywords = 0;
    let totalProductTargets = 0;
    let totalAdGroups = 0;
    let totalWinnerKeywords = 0;
    let totalBoostCandidateKeywords = 0;
    let totalSpend = 0;
    let totalSales = 0;

    for (const c of campaigns) {
      totalAdGroups += c.adGroups.length;
      for (const ag of c.adGroups) {
        totalKeywords += ag.keywords.filter((k) => k.state !== 'archived').length;
        totalProductTargets += ag.targets.filter((t) => t.state !== 'archived').length;
      }
    }

    for (const [, insights] of entityInsightsMap) {
      for (const insight of insights) {
        if (insight.diagnosisCode === 'winner') totalWinnerKeywords++;
        if (insight.diagnosisCode === 'boost_candidate') totalBoostCandidateKeywords++;
        totalSpend += insight.summaryFacts.spend || 0;
        totalSales += insight.summaryFacts.sales || 0;
      }
    }

    const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;

    return {
      lifecyclePhase: bookContext.lifecyclePhase,
      totalCampaigns: campaigns.length,
      totalAdGroups,
      totalKeywords,
      totalProductTargets,
      totalWinnerKeywords,
      totalBoostCandidateKeywords,
      avgAcos: Math.round(avgAcos * 10) / 10,
      totalSpend30d: Math.round(totalSpend * 100) / 100,
      totalSales30d: Math.round(totalSales * 100) / 100,
    };
  }
}
