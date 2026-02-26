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
import { GUARDS } from '@/config/guards';

import { StructureAnalyzerService } from './services/structure-analyzer.service';
import { CampaignClassifierService } from './services/campaign-classifier.service';
import { ScenarioSelectorService } from './services/scenario-selector.service';
import { MaturityScorerService } from './services/maturity-scorer.service';
import { RoadmapGeneratorService } from './services/roadmap-generator.service';

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
} from './campaign-evolution.types';

@Injectable()
export class CampaignEvolutionService {
  private readonly logger = new Logger(CampaignEvolutionService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly insightsService: InsightsService,
    private readonly structureAnalyzer: StructureAnalyzerService,
    private readonly campaignClassifier: CampaignClassifierService,
    private readonly scenarioSelector: ScenarioSelectorService,
    private readonly maturityScorer: MaturityScorerService,
    private readonly roadmapGenerator: RoadmapGeneratorService,
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

    // 14. Roadmap
    const roadmap = this.roadmapGenerator.generateRoadmap({
      scenario,
      bookContext,
      suggestions,
      campaigns: activeCampaigns,
      campaignRoles,
    });

    // 15. Context stats
    const context = this.buildContext(activeCampaigns, entityInsightsMap, bookContext);

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
      campaignRoles,
      structuralIssues,
      suggestions,
      roadmap,
      nextCampaignRecommendations,
      diversificationOpportunities,
      context,
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
    // 1. Get campaign IDs mapped to this book
    const mappings = await this.db
      .select({ campaignId: campaignBookMapping.campaignId })
      .from(campaignBookMapping)
      .where(eq(campaignBookMapping.bookId, bookId));

    const campaignIds = mappings.map((m: any) => m.campaignId);
    if (campaignIds.length === 0) return { campaigns: [] };

    // 2. Load campaigns
    const allCampaigns = await this.db
      .select()
      .from(campaigns)
      .where(inArray(campaigns.id, campaignIds));

    // 3. Load ad groups for all campaigns
    const allAdGroups = await this.db
      .select()
      .from(adGroups)
      .where(inArray(adGroups.campaignId, campaignIds));

    const adGroupIds = allAdGroups.map((ag: any) => ag.id);

    // 4. Load keywords and targets for all ad groups
    const [allKeywords, allTargets] = await Promise.all([
      adGroupIds.length > 0
        ? this.db.select().from(keywords).where(inArray(keywords.adGroupId, adGroupIds))
        : [],
      adGroupIds.length > 0
        ? this.db.select().from(productTargets).where(inArray(productTargets.adGroupId, adGroupIds))
        : [],
    ]);

    // 5. Index by parent ID
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

    // 6. Assemble graph
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

    // Collect all entity keys to batch-fetch metrics
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

    // Batch fetch metrics
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

    // Aggregate metrics by entity key
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

    // Compute insights per entity
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

    // Group insights by campaign ID
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

      // Compute macro strategy from entity insights
      const macro = this.insightsService.getCampaignMacroStrategy(campaignInsights);
      macroStrategies.set(campaign.id, macro);
    }

    return { entityInsightsMap, macroStrategies };
  }

  // ── Context Builder ───────────────────────────────────────────

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
      }
    }

    return {
      lifecyclePhase: bookContext.lifecyclePhase,
      totalCampaigns: campaigns.length,
      totalAdGroups,
      totalKeywords,
      totalProductTargets,
      totalWinnerKeywords,
      totalBoostCandidateKeywords,
    };
  }
}
