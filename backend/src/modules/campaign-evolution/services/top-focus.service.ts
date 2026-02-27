import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  Scenario,
  GapType,
  type TopFocus,
  type TopFocusContext,
  type CreationPlan,
  type CampaignToCreate,
  type CampaignPlanType,
  type BiddingStrategy,
  type TopFocusTheme,
  type CtaIntent,
  type StructuralGap,
  type PauseStrategy,
  type CampaignToPause,
  type HarvestedAssets,
  type CampaignExplanation,
  type PlacementAdjustments,
  type CreationMode,
} from '../campaign-evolution.types';
import { HarvestPlanBuilderService } from './harvest-plan-builder.service';
import { ResetPlanBuilderService } from './reset-plan-builder.service';
import {
  LIFECYCLE_DEFAULTS,
  BID_GUARDS,
  LIFECYCLE_DEFAULT_BIDS,
  LIFECYCLE_BID_STRATEGY,
  STRATEGIC_BUDGETS,
  WINNER_BID_MULTIPLIER,
  PLACEMENT_TOP_OF_SEARCH_BOOST_MIN,
  PLACEMENT_TOP_OF_SEARCH_BOOST_MAX,
  PLACEMENT_PERFORMANCE_THRESHOLD,
} from '../constants';

/** Gap types that justify intent=CREATE */
const CREATE_WORTHY_GAPS = new Set([
  GapType.GAP_EXPLORATION,
  GapType.GAP_VALIDATION,
  GapType.GAP_AMPLIFICATION,
]);

@Injectable()
export class TopFocusService {
  private readonly logger = new Logger(TopFocusService.name);
  private readonly harvestBuilder = new HarvestPlanBuilderService();
  private readonly resetBuilder = new ResetPlanBuilderService();

  // ══════════════════════════════════════════════════════════════
  // ── MODE-BASED PLAN GENERATION (v3 — user-driven strategy) ──
  // ══════════════════════════════════════════════════════════════

  /**
   * Generate a creation plan based on user-selected mode.
   * This is the NEW primary entry point for campaign creation.
   *
   * HARVEST: recovers winners, ASINs, negatives from existing campaigns
   * RESET: starts fresh with lifecycle defaults only
   *
   * Gaps are INFORMATIONAL only — they don't drive creation.
   * Creation is driven solely by the user's button click + mode choice.
   */
  generateCreationPlanForMode(
    ctx: TopFocusContext,
    harvestedAssets: HarvestedAssets,
    mode: CreationMode,
  ): CreationPlan {
    this.logger.log(`Generating plan for mode=${mode}, lifecycle=${ctx.bookContext.lifecyclePhase}`);

    let campaignsToCreate: CampaignToCreate[];

    if (mode === 'HARVEST') {
      campaignsToCreate = this.harvestBuilder.buildPlan(ctx, harvestedAssets);
    } else {
      campaignsToCreate = this.resetBuilder.buildPlan(ctx, harvestedAssets);
    }

    // If no campaigns generated (shouldn't happen, but safety), create at least an Auto
    if (campaignsToCreate.length === 0) {
      this.logger.warn('No campaigns generated — forcing SP_AUTO');
      campaignsToCreate = this.resetBuilder.buildPlan(
        { ...ctx, bookContext: { ...ctx.bookContext, lifecyclePhase: 'launch' } },
        harvestedAssets,
      );
    }

    const planId = randomUUID();
    const fingerprint = this.computePlanFingerprint(ctx, campaignsToCreate);
    const gaps = (ctx.gaps || []).map(g => g.type);
    const pauseStrategy = this.buildPauseStrategy(ctx);

    return {
      planId,
      fingerprint,
      campaignsToCreate,
      gaps,
      pauseStrategy: pauseStrategy && pauseStrategy.campaignsToPause.length > 0 ? pauseStrategy : undefined,
    };
  }

  // ── Top Focus Computation ─────────────────────────────────────

  computeTopFocus(ctx: TopFocusContext): TopFocus {
    // First: compute scenario-based focus
    let focus: TopFocus;

    switch (ctx.scenario) {
      case Scenario.A:
        focus = this.focusForA(ctx);
        break;
      case Scenario.B:
        focus = this.focusForB(ctx);
        break;
      case Scenario.C:
        focus = this.focusForC(ctx);
        break;
      case Scenario.STABLE:
      default:
        focus = this.focusForStable(ctx);
        break;
    }

    // Second: if STABLE + gaps exist → override intent
    if (ctx.scenario === Scenario.STABLE && ctx.gaps && ctx.gaps.length > 0) {
      focus = this.overrideStableWithGaps(ctx, focus);
    }

    return focus;
  }

  // ── Creation Plan (only when intent=CREATE) ───────────────────

  generateCreationPlan(ctx: TopFocusContext, harvestedAssets?: HarvestedAssets): CreationPlan | undefined {
    const topFocus = this.computeTopFocus(ctx);
    if (topFocus.primaryCta.intent !== 'CREATE') return undefined;

    const planId = randomUUID();
    const campaignsToCreate = harvestedAssets
      ? this.buildStrategicPlan(ctx, harvestedAssets)
      : this.buildCampaignsToCreate(ctx);

    if (campaignsToCreate.length === 0) return undefined;

    const fingerprint = this.computePlanFingerprint(ctx, campaignsToCreate);
    const gaps = (ctx.gaps || []).map(g => g.type);

    // Build pause strategy if CLEANUP gap + rebuild scenario
    const pauseStrategy = this.buildPauseStrategy(ctx);

    const plan: CreationPlan = { planId, fingerprint, campaignsToCreate, gaps, pauseStrategy };

    // Link plan to CTA
    topFocus.primaryCta.planId = planId;

    return plan;
  }

  /**
   * Force-generate a creation plan (for rebuild wizard). Ignores intent check.
   */
  generateCreationPlanForced(ctx: TopFocusContext, harvestedAssets: HarvestedAssets): CreationPlan {
    const planId = randomUUID();
    const campaignsToCreate = this.buildStrategicPlan(ctx, harvestedAssets);
    const fingerprint = this.computePlanFingerprint(ctx, campaignsToCreate);
    const gaps = (ctx.gaps || []).map(g => g.type);
    const pauseStrategy = this.buildPauseStrategy(ctx);

    return { planId, fingerprint, campaignsToCreate, gaps, pauseStrategy };
  }

  // ── Gap-Aware STABLE Override ───────────────────────────────

  private overrideStableWithGaps(ctx: TopFocusContext, originalFocus: TopFocus): TopFocus {
    const gaps = ctx.gaps || [];
    const criticalOrHigh = gaps.filter(g => g.severity === 'critical' || g.severity === 'high');

    if (criticalOrHigh.length === 0) return originalFocus;

    const hasCreateWorthy = criticalOrHigh.some(g => CREATE_WORTHY_GAPS.has(g.type));
    const hasCleanupOnly = criticalOrHigh.every(g => g.type === GapType.GAP_CLEANUP);

    if (hasCreateWorthy) {
      // Find the top priority gap to drive the message
      const topGap = criticalOrHigh.find(g => CREATE_WORTHY_GAPS.has(g.type)) || criticalOrHigh[0];
      return this.focusFromGap(ctx, topGap, 'CREATE');
    }

    if (hasCleanupOnly) {
      const topGap = criticalOrHigh[0];
      return this.focusFromGap(ctx, topGap, 'CLEANUP');
    }

    return originalFocus;
  }

  private focusFromGap(ctx: TopFocusContext, gap: StructuralGap, intent: CtaIntent): TopFocus {
    const themeMap: Record<string, TopFocusTheme> = {
      [GapType.GAP_EXPLORATION]: 'VISIBILITE',
      [GapType.GAP_VALIDATION]: 'CONVERSION',
      [GapType.GAP_AMPLIFICATION]: 'RENTABILITE',
      [GapType.GAP_DIVERSIFICATION]: 'VISIBILITE',
      [GapType.GAP_VIDEO]: 'RENTABILITE',
      [GapType.GAP_CLEANUP]: 'STRUCTURE',
    };

    const ctaLabelMap: Record<string, Record<string, string>> = {
      CREATE: {
        [GapType.GAP_EXPLORATION]: 'Créer mes campagnes recommandées',
        [GapType.GAP_VALIDATION]: 'Créer mes campagnes recommandées',
        [GapType.GAP_AMPLIFICATION]: 'Isoler mes gagnants',
        default: 'Créer les campagnes recommandées',
      },
      CLEANUP: {
        [GapType.GAP_CLEANUP]: 'Repartir proprement',
        default: 'Nettoyer la structure',
      },
    };

    const ctaLabels = ctaLabelMap[intent] || ctaLabelMap['CREATE'];
    const ctaLabel = ctaLabels[gap.type] || ctaLabels['default'];

    const evidence = [
      { label: gap.label, value: gap.explanation.slice(0, 60) },
    ];

    // Add second evidence if available
    if (ctx.context.totalCampaigns > 0) {
      evidence.push({ label: 'Campagnes actives', value: `${ctx.context.totalCampaigns}` });
    }

    return {
      theme: themeMap[gap.type] || 'VISIBILITE',
      title: gap.label,
      summary: gap.explanation,
      evidence: evidence.slice(0, 2),
      primaryCta: {
        label: ctaLabel,
        intent,
      },
    };
  }

  // ── Scenario A: No campaigns → VISIBILITE + CREATE ────────────

  private focusForA(ctx: TopFocusContext): TopFocus {
    return {
      theme: 'VISIBILITE',
      title: 'Lancer tes premières campagnes',
      summary: 'Tu n\'as pas encore de publicité pour ce livre. On va créer une structure de base pour commencer à collecter des données et générer des ventes.',
      evidence: [
        { label: 'Campagnes actives', value: '0' },
        { label: 'Visibilité actuelle', value: 'Aucune' },
      ],
      primaryCta: {
        label: 'Créer les campagnes recommandées',
        intent: 'CREATE',
      },
    };
  }

  // ── Scenario B: Chaos → STRUCTURE + CLEANUP or CREATE ─────────

  private focusForB(ctx: TopFocusContext): TopFocus {
    const hasBasicStructure = this.hasBasicCampaignStructure(ctx);
    const intent: CtaIntent = hasBasicStructure ? 'CLEANUP' : 'CREATE';

    const evidence = [];
    if (ctx.duplicationScore > 0.4) {
      evidence.push({
        label: 'Mots-clés en doublon',
        value: `${(ctx.duplicationScore * 100).toFixed(0)}% de cannibalisation`,
      });
    }
    if (ctx.chaosScore > 0.5) {
      evidence.push({
        label: 'Score de désordre',
        value: `${(ctx.chaosScore * 100).toFixed(0)}% — structure à simplifier`,
      });
    }
    if (evidence.length === 0) {
      evidence.push({ label: 'Campagnes', value: `${ctx.context.totalCampaigns} actives` });
    }

    const finalEvidence = evidence.slice(0, 2);

    if (intent === 'CLEANUP') {
      return {
        theme: 'STRUCTURE',
        title: 'Nettoyer la structure publicitaire',
        summary: 'Tes campagnes se marchent dessus. On va consolider pour que chaque euro aille au bon endroit.',
        evidence: finalEvidence,
        primaryCta: {
          label: 'Nettoyer la structure',
          intent: 'CLEANUP',
        },
      };
    }

    return {
      theme: 'STRUCTURE',
      title: 'Reconstruire une base solide',
      summary: 'Ta structure publicitaire est désorganisée et il manque des campagnes clés. On va recréer un socle propre.',
      evidence: finalEvidence,
      primaryCta: {
        label: 'Créer les campagnes recommandées',
        intent: 'CREATE',
      },
    };
  }

  // ── Scenario C: Winners → RENTABILITE/AMPLIFY ─────────────────

  private focusForC(ctx: TopFocusContext): TopFocus {
    const winnerCount = ctx.context.totalWinnerKeywords;
    const needsExactCampaign = this.needsDedicatedExactCampaign(ctx);
    const intent: CtaIntent = needsExactCampaign ? 'CREATE' : 'AMPLIFY';

    const evidence = [
      {
        label: 'Mots-clés gagnants',
        value: `${winnerCount} WINNER${winnerCount > 1 ? 's' : ''} identifié${winnerCount > 1 ? 's' : ''}`,
      },
    ];

    const avgAcos = ctx.context.avgAcos;
    if (avgAcos !== undefined && avgAcos > 0) {
      evidence.push({
        label: 'ACoS moyen 30j',
        value: `${avgAcos.toFixed(0)}%`,
      });
    } else if (ctx.context.totalSpend30d) {
      evidence.push({
        label: 'Dépense 30j',
        value: `${ctx.context.totalSpend30d.toFixed(0)}€`,
      });
    }

    if (intent === 'CREATE') {
      return {
        theme: 'RENTABILITE',
        title: 'Isoler tes gagnants en campagne Exact',
        summary: `Tu as ${winnerCount} mot${winnerCount > 1 ? 's' : ''}-clé${winnerCount > 1 ? 's' : ''} qui convertissent bien mais ne sont pas encore isolés en Exact. On va les pousser pour scaler.`,
        evidence: evidence.slice(0, 2),
        primaryCta: {
          label: 'Créer les campagnes recommandées',
          intent: 'CREATE',
        },
      };
    }

    return {
      theme: 'RENTABILITE',
      title: 'Accélérer tes gagnants',
      summary: `Tu as ${winnerCount} mot${winnerCount > 1 ? 's' : ''}-clé${winnerCount > 1 ? 's' : ''} gagnant${winnerCount > 1 ? 's' : ''} déjà en Exact. On va augmenter les enchères et la visibilité pour maximiser les ventes.`,
      evidence: evidence.slice(0, 2),
      primaryCta: {
        label: 'Accélérer les gagnants',
        intent: 'AMPLIFY',
      },
    };
  }

  // ── Scenario STABLE → OBSERVE ─────────────────────────────────

  private focusForStable(ctx: TopFocusContext): TopFocus {
    const evidence = [
      { label: 'Campagnes actives', value: `${ctx.context.totalCampaigns}` },
    ];

    if (ctx.maturityScore > 0) {
      evidence.push({ label: 'Score maturité', value: `${ctx.maturityScore}/100` });
    }

    return {
      theme: 'VISIBILITE',
      title: 'Tes campagnes tournent bien',
      summary: `Tes ${ctx.context.totalCampaigns} campagnes sont stables. Continue de surveiller et optimise à la marge.`,
      evidence: evidence.slice(0, 2),
      primaryCta: {
        label: 'Rien à faire maintenant — surveiller',
        intent: 'OBSERVE',
      },
    };
  }

  // ══════════════════════════════════════════════════════════════
  // ── STRATEGIC PLAN BUILDER (v2 — deterministic, data-driven) ─
  // ══════════════════════════════════════════════════════════════

  /**
   * Build a strategic creation plan using harvested assets.
   * Rules:
   * 1. Auto is ALWAYS the base (exploration)
   * 2. Expression/Broad if userProvidedKeywords OR winnerSearchTerms exist
   * 3. Exact if winnerKeywords OR winnerSearchTerms exist
   * 4. Product Targeting if winnerAsins exist
   * 5. Category if scale/evergreen and no product targeting exists
   *
   * All parameters (bid, strategy, placement, budget) are 100% deterministic.
   */
  private buildStrategicPlan(ctx: TopFocusContext, harvest: HarvestedAssets): CampaignToCreate[] {
    const bookTitle = (ctx.bookContext.title || ctx.bookContext.asin || 'Livre').slice(0, 25);
    const lifecycle = (ctx.bookContext.lifecyclePhase || 'launch') as string;
    const result: CampaignToCreate[] = [];
    const existingTypes = this.getExistingCampaignTypes(ctx);

    // ── Compute shared parameters ────────────────────────
    const bid = this.computeStrategicBid(lifecycle, harvest);
    const budgets = STRATEGIC_BUDGETS[lifecycle] || STRATEGIC_BUDGETS.launch;
    const bidStrategies = LIFECYCLE_BID_STRATEGY[lifecycle] || LIFECYCLE_BID_STRATEGY.launch;
    const placementAdj = this.computeStrategicPlacements(harvest);

    const hasSeeds = harvest.userProvidedKeywords.length > 0 ||
                     harvest.winnerSearchTerms.length > 0 ||
                     harvest.winnerKeywords.length > 0;
    const hasWinners = harvest.winnerKeywords.length > 0 || harvest.winnerSearchTerms.length > 0;
    const hasAsins = harvest.winnerAsins.length > 0;

    // ── 1. SP Auto (ALWAYS — the base) ────────────────────
    if (!existingTypes.has('auto')) {
      const autoBudget = budgets['SP_AUTO'] || budgets['default'];
      const autoStrategy = bidStrategies['SP_AUTO'] || bidStrategies['default'];
      const autoNegatives = harvest.suggestedNegatives.slice(0, 20);

      result.push({
        name: `${bookTitle}-SP-Auto`,
        type: 'SP_AUTO',
        targetingMode: 'AUTO',
        dailyBudget: autoBudget,
        defaultBid: bid.auto,
        biddingStrategy: autoStrategy,
        placementAdjustments: placementAdj,
        negativeKeywords: autoNegatives.length > 0 ? autoNegatives : undefined,
        notesWhy: 'Campagne de découverte — Amazon teste automatiquement les requêtes pour ton livre.',
        explanations: [
          this.explainType('SP_AUTO'),
          this.explainBid(bid.auto, bid.source, 'auto'),
          this.explainBudget(autoBudget, lifecycle, 'SP_AUTO'),
          this.explainStrategy(autoStrategy, lifecycle, 'SP_AUTO'),
          ...(placementAdj ? [this.explainPlacement(placementAdj, harvest.topPlacementPerformance)] : []),
          ...(autoNegatives.length > 0 ? [this.explainNegatives(autoNegatives.length)] : []),
        ],
      });
    }

    // ── 2. SP Expression/Broad (if seeds exist) ──────────
    if (hasSeeds && !existingTypes.has('broad')) {
      const broadKeywords = this.mergeKeywordsForBroad(harvest);
      const broadBudget = budgets['SP_MANUAL_BROAD'] || budgets['default'];
      const broadStrategy = bidStrategies['SP_MANUAL_BROAD'] || bidStrategies['default'];

      result.push({
        name: `${bookTitle}-SP-Expression`,
        type: 'SP_MANUAL_BROAD',
        targetingMode: 'MANUAL',
        dailyBudget: broadBudget,
        defaultBid: bid.manual,
        biddingStrategy: broadStrategy,
        placementAdjustments: placementAdj,
        seedKeywords: broadKeywords,
        negativeKeywords: harvest.suggestedNegatives.slice(0, 15),
        notesWhy: `Ciblage large sur ${broadKeywords.length} termes — découvre les variantes qui convertissent.`,
        explanations: [
          this.explainType('SP_MANUAL_BROAD'),
          this.explainBid(bid.manual, bid.source, 'manual'),
          this.explainBudget(broadBudget, lifecycle, 'SP_MANUAL_BROAD'),
          this.explainStrategy(broadStrategy, lifecycle, 'SP_MANUAL_BROAD'),
          this.explainKeywords(broadKeywords.length, hasWinners ? 'winners+inferred' : 'inferred'),
          ...(placementAdj ? [this.explainPlacement(placementAdj, harvest.topPlacementPerformance)] : []),
        ],
      });
    }

    // ── 3. SP Exact (if winners exist) ───────────────────
    if (hasWinners && !this.hasExactForWinners(ctx)) {
      const exactKeywords = this.mergeKeywordsForExact(harvest);
      const exactBudget = budgets['SP_MANUAL_EXACT'] || budgets['default'];
      const exactStrategy = bidStrategies['SP_MANUAL_EXACT'] || bidStrategies['default'];
      const exactBid = bid.winners || bid.manual;

      result.push({
        name: `${bookTitle}-SP-Exact-Winners`,
        type: 'SP_MANUAL_EXACT',
        targetingMode: 'MANUAL',
        dailyBudget: exactBudget,
        defaultBid: exactBid,
        biddingStrategy: exactStrategy,
        placementAdjustments: placementAdj,
        seedKeywords: exactKeywords,
        notesWhy: `Isole tes ${exactKeywords.length} gagnants en Exact — enchère maîtrisée, conversion max.`,
        explanations: [
          this.explainType('SP_MANUAL_EXACT'),
          this.explainBid(exactBid, bid.winnersSource || bid.source, 'exact_winners'),
          this.explainBudget(exactBudget, lifecycle, 'SP_MANUAL_EXACT'),
          this.explainStrategy(exactStrategy, lifecycle, 'SP_MANUAL_EXACT'),
          this.explainKeywords(exactKeywords.length, 'winners'),
          ...(placementAdj ? [this.explainPlacement(placementAdj, harvest.topPlacementPerformance)] : []),
        ],
      });
    }

    // ── 4. SP Product (if winner ASINs exist) ────────────
    if (hasAsins && !existingTypes.has('product')) {
      const productBudget = budgets['SP_PRODUCT'] || budgets['default'];
      const productStrategy = bidStrategies['SP_PRODUCT'] || bidStrategies['default'];

      result.push({
        name: `${bookTitle}-SP-Product`,
        type: 'SP_PRODUCT',
        targetingMode: 'MANUAL',
        dailyBudget: productBudget,
        defaultBid: bid.manual,
        biddingStrategy: productStrategy,
        seedAsins: harvest.winnerAsins,
        notesWhy: `Cible ${harvest.winnerAsins.length} fiches produit similaires — trafic qualifié.`,
        explanations: [
          this.explainType('SP_PRODUCT'),
          this.explainBid(bid.manual, bid.source, 'product'),
          this.explainBudget(productBudget, lifecycle, 'SP_PRODUCT'),
          this.explainStrategy(productStrategy, lifecycle, 'SP_PRODUCT'),
          { parameter: 'asins', value: `${harvest.winnerAsins.length} ASINs`, reasoning: 'ASINs identifiés comme gagnants dans tes campagnes existantes — livres similaires au tien qui génèrent des ventes.', dataSource: 'real_data' },
        ],
      });
    }

    // ── 5. SP Category (if scale/evergreen and no product) ─
    if ((lifecycle === 'scale' || lifecycle === 'evergreen') && !existingTypes.has('product') && !hasAsins) {
      const catBudget = budgets['SP_CATEGORY'] || budgets['default'];
      const catStrategy = bidStrategies['SP_CATEGORY'] || bidStrategies['default'];

      result.push({
        name: `${bookTitle}-SP-Category`,
        type: 'SP_CATEGORY',
        targetingMode: 'MANUAL',
        dailyBudget: catBudget,
        defaultBid: bid.manual,
        biddingStrategy: catStrategy,
        notesWhy: 'Ciblage par catégorie — explore un public large dans ta niche.',
        explanations: [
          this.explainType('SP_CATEGORY'),
          this.explainBid(bid.manual, bid.source, 'category'),
          this.explainBudget(catBudget, lifecycle, 'SP_CATEGORY'),
          this.explainStrategy(catStrategy, lifecycle, 'SP_CATEGORY'),
        ],
      });
    }

    return result;
  }

  // ── Strategic Bid Computation ─────────────────────────────────

  private computeStrategicBid(lifecycle: string, harvest: HarvestedAssets): {
    auto: number;
    manual: number;
    winners: number | null;
    source: string;
    winnersSource: string | null;
  } {
    const fallback = LIFECYCLE_DEFAULT_BIDS[lifecycle] || LIFECYCLE_DEFAULT_BIDS.launch;

    // Winners bid: avgWinningBid * 1.05, clamped
    let winners: number | null = null;
    let winnersSource: string | null = null;
    if (harvest.avgWinningBid !== null) {
      winners = this.clampBid(harvest.avgWinningBid * WINNER_BID_MULTIPLIER);
      winnersSource = 'real_data';
    }

    // Manual bid: avgCpcObserved or fallback
    let manual: number;
    let source: string;
    if (harvest.avgCpcObserved !== null) {
      manual = this.clampBid(harvest.avgCpcObserved);
      source = 'real_data';
    } else {
      manual = fallback;
      source = 'lifecycle_default';
    }

    // Auto bid: slightly lower than manual (discovery)
    const auto = this.clampBid(manual * 0.9);

    return { auto, manual, winners, source, winnersSource };
  }

  private clampBid(bid: number): number {
    return Math.round(Math.max(BID_GUARDS.absoluteMin, Math.min(BID_GUARDS.absoluteMax, bid)) * 100) / 100;
  }

  // ── Strategic Placement Computation ───────────────────────────

  private computeStrategicPlacements(harvest: HarvestedAssets): PlacementAdjustments | undefined {
    if (harvest.topPlacementPerformance === null || harvest.topPlacementPerformance <= PLACEMENT_PERFORMANCE_THRESHOLD) {
      return undefined; // No data or top not better → no adjustment
    }

    // Scale boost linearly: ratio 1.0-2.0 → 20-40%
    const ratio = Math.min(harvest.topPlacementPerformance, 2.0);
    const boost = Math.round(
      PLACEMENT_TOP_OF_SEARCH_BOOST_MIN +
      (ratio - PLACEMENT_PERFORMANCE_THRESHOLD) *
      (PLACEMENT_TOP_OF_SEARCH_BOOST_MAX - PLACEMENT_TOP_OF_SEARCH_BOOST_MIN),
    );

    return {
      topOfSearch: Math.min(boost, PLACEMENT_TOP_OF_SEARCH_BOOST_MAX),
      restOfSearch: 0,
      productPages: 0,
    };
  }

  // ── Keyword Merge Helpers ─────────────────────────────────────

  private mergeKeywordsForBroad(harvest: HarvestedAssets): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    // Priority: winner keywords → winner search terms → user provided
    for (const kw of harvest.winnerKeywords) {
      const lower = kw.text.toLowerCase();
      if (!seen.has(lower)) { seen.add(lower); result.push(kw.text); }
    }
    for (const st of harvest.winnerSearchTerms) {
      const lower = st.query.toLowerCase();
      if (!seen.has(lower)) { seen.add(lower); result.push(st.query); }
    }
    for (const kw of harvest.userProvidedKeywords) {
      const lower = kw.toLowerCase();
      if (!seen.has(lower)) { seen.add(lower); result.push(kw); }
    }

    return result.slice(0, 25); // cap at 25
  }

  private mergeKeywordsForExact(harvest: HarvestedAssets): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    // Only real winners: winner keywords → winner search terms (no inferred)
    for (const kw of harvest.winnerKeywords) {
      const lower = kw.text.toLowerCase();
      if (!seen.has(lower)) { seen.add(lower); result.push(kw.text); }
    }
    for (const st of harvest.winnerSearchTerms) {
      const lower = st.query.toLowerCase();
      if (!seen.has(lower)) { seen.add(lower); result.push(st.query); }
    }

    return result.slice(0, 20); // cap at 20
  }

  private hasExactForWinners(ctx: TopFocusContext): boolean {
    // Check if a dedicated Exact campaign already isolates winner keywords
    const winnerKeys = new Set<string>();
    for (const [, insights] of ctx.entityInsightsMap) {
      for (const insight of insights) {
        if (insight.diagnosisCode === 'winner' && insight.entityKey.startsWith('keyword:')) {
          winnerKeys.add(insight.entityKey);
        }
      }
    }
    if (winnerKeys.size === 0) return true; // no winners → nothing to isolate

    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      const exactKws = c.adGroups.flatMap(ag =>
        ag.keywords.filter(k => k.matchType === 'exact' && k.state !== 'archived'),
      );
      const winnerInExact = exactKws.filter(k => winnerKeys.has(`keyword:${k.id}`));
      if (winnerInExact.length >= winnerKeys.size * 0.5) return true;
    }
    return false;
  }

  // ── Explanation Generators ────────────────────────────────────

  private explainType(type: CampaignPlanType): CampaignExplanation {
    const typeExplanations: Record<string, string> = {
      SP_AUTO: 'Amazon choisit automatiquement les requêtes. Idéal pour découvrir de nouveaux mots-clés sans effort.',
      SP_MANUAL_BROAD: 'Ciblage large (Expression) : tes mots-clés + variantes proches. Bon compromis découverte/contrôle.',
      SP_MANUAL_PHRASE: 'Ciblage Phrase : Amazon affiche ton livre quand la requête contient tes termes dans l\'ordre.',
      SP_MANUAL_EXACT: 'Ciblage Exact : tes mots-clés uniquement, sans variante. Conversion maximale, contrôle total.',
      SP_PRODUCT: 'Ciblage produit : affiche ton livre sur les fiches de livres similaires. Trafic très qualifié.',
      SP_CATEGORY: 'Ciblage catégorie : explore un public large dans ta niche Amazon.',
      SB_VIDEO: 'Campagne vidéo Sponsored Brands : forte visibilité en haut de page.',
    };

    return {
      parameter: 'type',
      value: type,
      reasoning: typeExplanations[type] || 'Type de campagne sélectionné pour couvrir tes besoins.',
      dataSource: 'rule_based',
    };
  }

  private explainBid(bid: number, source: string, context: string): CampaignExplanation {
    let reasoning: string;
    if (source === 'real_data' && context === 'exact_winners') {
      reasoning = `Enchère basée sur le CPC réel de tes gagnants (×${WINNER_BID_MULTIPLIER}). Tu paies un peu plus pour garder la première position sur tes meilleurs termes.`;
    } else if (source === 'real_data') {
      reasoning = 'Enchère basée sur le CPC moyen observé dans tes campagnes existantes. Réaliste par rapport à ton marché.';
    } else {
      reasoning = `Enchère par défaut pour la phase "${context}". Sera ajustée automatiquement par Amazon selon la compétition.`;
    }

    return {
      parameter: 'bid',
      value: `${bid.toFixed(2)}€`,
      reasoning,
      dataSource: source,
    };
  }

  private explainBudget(budget: number, lifecycle: string, type: string): CampaignExplanation {
    const lifecycleLabels: Record<string, string> = {
      launch: 'lancement', scale: 'croissance', evergreen: 'croisière', relaunch: 'relancement',
    };
    return {
      parameter: 'budget',
      value: `${budget}€/jour`,
      reasoning: `Budget adapté à la phase ${lifecycleLabels[lifecycle] || lifecycle} pour une campagne ${type}. Assez pour collecter des données sans gaspiller.`,
      dataSource: 'rule_based',
    };
  }

  private explainStrategy(strategy: BiddingStrategy, lifecycle: string, type: string): CampaignExplanation {
    const strategyLabels: Record<string, string> = {
      UP_DOWN: 'Ajustement dynamique (Up & Down)',
      DOWN_ONLY: 'Réduction uniquement (Down Only)',
      FIXED: 'Enchère fixe',
    };
    const reasonings: Record<string, string> = {
      UP_DOWN: 'Amazon peut augmenter ou diminuer ton enchère selon la probabilité de conversion. Plus agressif, idéal en phase de découverte ou pour les gagnants.',
      DOWN_ONLY: 'Amazon ne peut que baisser ton enchère. Protège ton budget tout en restant compétitif.',
      FIXED: 'Enchère fixe, pas d\'ajustement automatique. Maximum de contrôle.',
    };

    return {
      parameter: 'biddingStrategy',
      value: strategyLabels[strategy] || strategy,
      reasoning: reasonings[strategy] || 'Stratégie sélectionnée selon ta phase de vie et le type de campagne.',
      dataSource: 'rule_based',
    };
  }

  private explainPlacement(placement: PlacementAdjustments, ratio: number | null): CampaignExplanation {
    return {
      parameter: 'placementAdjustments',
      value: `Top of Search +${placement.topOfSearch}%`,
      reasoning: ratio !== null
        ? `Tes données montrent que le haut de page convertit ${ratio.toFixed(1)}× mieux. On booste la visibilité là où ça marche.`
        : 'Boost du haut de page pour maximiser la visibilité sur les requêtes ciblées.',
      dataSource: ratio !== null ? 'real_data' : 'rule_based',
    };
  }

  private explainKeywords(count: number, source: string): CampaignExplanation {
    const sourceLabel = source === 'winners'
      ? 'mots-clés gagnants identifiés dans tes campagnes'
      : source === 'winners+inferred'
      ? 'mix de gagnants réels et termes inférés du titre'
      : 'termes inférés du titre de ton livre';

    return {
      parameter: 'keywords',
      value: `${count} mots-clés`,
      reasoning: `${count} ${sourceLabel}. Ce sont tes meilleurs candidats pour générer des ventes.`,
      dataSource: source.includes('winners') ? 'real_data' : 'inferred',
    };
  }

  private explainNegatives(count: number): CampaignExplanation {
    return {
      parameter: 'negatives',
      value: `${count} termes négatifs`,
      reasoning: 'Termes identifiés comme non-performants (dépense sans conversion). Les bloquer protège ton budget.',
      dataSource: 'real_data',
    };
  }

  // ── Legacy Build campaigns to create ─────────────────────────

  private buildCampaignsToCreate(ctx: TopFocusContext): CampaignToCreate[] {
    const bookTitle = (ctx.bookContext.title || ctx.bookContext.asin || 'Livre').slice(0, 25);
    const lifecycle = (ctx.bookContext.lifecyclePhase || 'launch') as keyof typeof LIFECYCLE_DEFAULTS;
    const defaults = LIFECYCLE_DEFAULTS[lifecycle] || LIFECYCLE_DEFAULTS.launch;

    // Gap-driven path: when STABLE + gaps exist, build from gaps
    if (ctx.scenario === Scenario.STABLE && ctx.gaps && ctx.gaps.length > 0) {
      return this.buildFromGaps(ctx, bookTitle, defaults);
    }

    // Scenario-driven path (original logic)
    return this.buildFromScenario(ctx, bookTitle, defaults);
  }

  private buildFromGaps(
    ctx: TopFocusContext,
    bookTitle: string,
    defaults: (typeof LIFECYCLE_DEFAULTS)[keyof typeof LIFECYCLE_DEFAULTS],
  ): CampaignToCreate[] {
    const result: CampaignToCreate[] = [];
    const gaps = ctx.gaps || [];
    const defaultBid = defaults.auto.defaultBid;

    for (const gap of gaps) {
      if (gap.severity === 'low') continue; // Only act on critical/high/medium

      switch (gap.type) {
        case GapType.GAP_EXPLORATION: {
          result.push({
            name: `${bookTitle}-SP-Auto`,
            type: 'SP_AUTO',
            targetingMode: 'AUTO',
            dailyBudget: defaults.auto.dailyBudget,
            defaultBid,
            biddingStrategy: 'DOWN_ONLY',
            notesWhy: 'Campagne de découverte : Amazon teste les mots-clés pour toi.',
            explanations: [this.explainType('SP_AUTO')],
          });
          break;
        }
        case GapType.GAP_VALIDATION: {
          const seeds = this.extractWinnerKeywordTexts(ctx);
          const seedsOrInferred = seeds.length > 0 ? seeds : this.inferSeedKeywords(ctx);
          result.push({
            name: `${bookTitle}-SP-Exact`,
            type: 'SP_MANUAL_EXACT',
            targetingMode: 'MANUAL',
            dailyBudget: defaults.manual.dailyBudget,
            defaultBid: defaults.manual.defaultBid,
            biddingStrategy: 'DOWN_ONLY',
            seedKeywords: seedsOrInferred,
            notesWhy: 'Cible les termes précis à forte intention d\'achat.',
            explanations: [this.explainType('SP_MANUAL_EXACT')],
          });
          break;
        }
        case GapType.GAP_AMPLIFICATION: {
          const winnerTexts = this.extractWinnerKeywordTexts(ctx);
          if (winnerTexts.length > 0) {
            result.push({
              name: `${bookTitle}-SP-Winners-Exact`,
              type: 'SP_MANUAL_EXACT',
              targetingMode: 'MANUAL',
              dailyBudget: Math.min(defaults.manual.dailyBudget * 1.5, defaults.maxDailyBudget),
              defaultBid: defaults.manual.defaultBid,
              biddingStrategy: 'UP_DOWN',
              seedKeywords: winnerTexts,
              notesWhy: `Isole tes ${winnerTexts.length} gagnants pour maximiser le retour.`,
              explanations: [this.explainType('SP_MANUAL_EXACT')],
            });
          }
          break;
        }
        case GapType.GAP_DIVERSIFICATION: {
          result.push({
            name: `${bookTitle}-SP-Product`,
            type: 'SP_PRODUCT',
            targetingMode: 'MANUAL',
            dailyBudget: defaults.manual.dailyBudget,
            defaultBid: defaults.manual.defaultBid,
            biddingStrategy: 'DOWN_ONLY',
            notesWhy: 'Cible les fiches de livres similaires pour capter du trafic qualifié.',
            explanations: [this.explainType('SP_PRODUCT')],
          });
          break;
        }
        case GapType.GAP_VIDEO: {
          result.push({
            name: `${bookTitle}-SB-Video`,
            type: 'SB_VIDEO',
            targetingMode: 'MANUAL',
            dailyBudget: Math.min(12, defaults.maxDailyBudget),
            defaultBid: defaults.manual.defaultBid,
            biddingStrategy: 'DOWN_ONLY',
            seedKeywords: this.extractWinnerKeywordTexts(ctx),
            notesWhy: 'Lance une campagne Sponsored Brands Video pour booster ta visibilité.',
            explanations: [this.explainType('SB_VIDEO')],
          });
          break;
        }
        // GAP_CLEANUP doesn't create campaigns
        default:
          break;
      }
    }

    return result;
  }

  private buildFromScenario(
    ctx: TopFocusContext,
    bookTitle: string,
    defaults: (typeof LIFECYCLE_DEFAULTS)[keyof typeof LIFECYCLE_DEFAULTS],
  ): CampaignToCreate[] {
    const lifecycle = (ctx.bookContext.lifecyclePhase || 'launch') as keyof typeof LIFECYCLE_DEFAULTS;
    const result: CampaignToCreate[] = [];
    const defaultBid = defaults.auto.defaultBid;

    if (ctx.scenario === Scenario.A) {
      result.push({
        name: `${bookTitle}-SP-Auto`,
        type: 'SP_AUTO',
        targetingMode: 'AUTO',
        dailyBudget: defaults.auto.dailyBudget,
        defaultBid,
        biddingStrategy: 'DOWN_ONLY',
        notesWhy: 'Campagne de découverte : Amazon teste les mots-clés pour toi.',
        explanations: [this.explainType('SP_AUTO')],
      });

      result.push({
        name: `${bookTitle}-SP-Exact`,
        type: 'SP_MANUAL_EXACT',
        targetingMode: 'MANUAL',
        dailyBudget: defaults.manual.dailyBudget,
        defaultBid: defaults.manual.defaultBid,
        biddingStrategy: 'DOWN_ONLY',
        seedKeywords: this.inferSeedKeywords(ctx),
        notesWhy: 'Cible les termes précis à forte intention d\'achat.',
        explanations: [this.explainType('SP_MANUAL_EXACT')],
      });

      if (lifecycle === 'scale' || lifecycle === 'evergreen') {
        result.push({
          name: `${bookTitle}-SP-Phrase`,
          type: 'SP_MANUAL_PHRASE',
          targetingMode: 'MANUAL',
          dailyBudget: defaults.manual.dailyBudget,
          defaultBid: defaults.manual.defaultBid,
          biddingStrategy: 'DOWN_ONLY',
          seedKeywords: this.inferSeedKeywords(ctx),
          notesWhy: 'Élargit la couverture tout en restant pertinent.',
          explanations: [this.explainType('SP_MANUAL_PHRASE')],
        });
      }
    } else if (ctx.scenario === Scenario.B) {
      const existingTypes = this.getExistingCampaignTypes(ctx);

      if (!existingTypes.has('auto')) {
        result.push({
          name: `${bookTitle}-SP-Auto`,
          type: 'SP_AUTO',
          targetingMode: 'AUTO',
          dailyBudget: defaults.auto.dailyBudget,
          defaultBid,
          biddingStrategy: 'DOWN_ONLY',
          notesWhy: 'Il te manque une campagne Auto pour la découverte.',
          explanations: [this.explainType('SP_AUTO')],
        });
      }

      if (!existingTypes.has('exact')) {
        result.push({
          name: `${bookTitle}-SP-Exact`,
          type: 'SP_MANUAL_EXACT',
          targetingMode: 'MANUAL',
          dailyBudget: defaults.manual.dailyBudget,
          defaultBid: defaults.manual.defaultBid,
          biddingStrategy: 'DOWN_ONLY',
          seedKeywords: this.extractWinnerKeywordTexts(ctx),
          notesWhy: 'Une campagne Exact dédiée pour tes meilleurs termes.',
          explanations: [this.explainType('SP_MANUAL_EXACT')],
        });
      }
    } else if (ctx.scenario === Scenario.C) {
      const winnerTexts = this.extractWinnerKeywordTexts(ctx);

      if (winnerTexts.length > 0 && this.needsDedicatedExactCampaign(ctx)) {
        result.push({
          name: `${bookTitle}-SP-Winners-Exact`,
          type: 'SP_MANUAL_EXACT',
          targetingMode: 'MANUAL',
          dailyBudget: Math.min(defaults.manual.dailyBudget * 1.5, defaults.maxDailyBudget),
          defaultBid: defaults.manual.defaultBid,
          biddingStrategy: 'UP_DOWN',
          seedKeywords: winnerTexts,
          notesWhy: `Isole tes ${winnerTexts.length} gagnants pour maximiser le retour.`,
          explanations: [this.explainType('SP_MANUAL_EXACT')],
        });
      }

      if (!this.hasProductTargeting(ctx)) {
        result.push({
          name: `${bookTitle}-SP-Product`,
          type: 'SP_PRODUCT',
          targetingMode: 'MANUAL',
          dailyBudget: defaults.manual.dailyBudget,
          defaultBid: defaults.manual.defaultBid,
          biddingStrategy: 'DOWN_ONLY',
          notesWhy: 'Cible les fiches de livres similaires pour capter du trafic qualifié.',
          explanations: [this.explainType('SP_PRODUCT')],
        });
      }
    }

    return result;
  }

  // ── Pause Strategy (for rebuild/cleanup) ─────────────────────

  private buildPauseStrategy(ctx: TopFocusContext): PauseStrategy | undefined {
    const hasCleanupGap = (ctx.gaps || []).some(
      g => g.type === GapType.GAP_CLEANUP && (g.severity === 'critical' || g.severity === 'high'),
    );

    if (!hasCleanupGap) return undefined;

    // Identify campaigns to pause: those classified as 'unknown' or with very poor performance
    const campaignsToPause: CampaignToPause[] = [];
    let totalBudgetToSave = 0;

    for (const cr of ctx.campaignRoles) {
      if (!cr.roles.includes('unknown')) continue;

      const campaign = ctx.campaigns.find(c => c.id === cr.campaignId);
      if (!campaign || campaign.state === 'archived') continue;

      // Harvest keywords and ASINs from this campaign
      const harvestedKeywords: string[] = [];
      const harvestedAsins: string[] = [];

      for (const ag of campaign.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state !== 'archived') harvestedKeywords.push(kw.keywordText);
        }
        for (const tg of ag.targets) {
          if (tg.state !== 'archived' && tg.expressionType === 'asinSameAs') {
            const asin = typeof tg.expression === 'string' ? tg.expression : tg.expression?.value;
            if (asin) harvestedAsins.push(asin);
          }
        }
      }

      campaignsToPause.push({
        campaignId: campaign.id,
        name: campaign.name,
        reason: 'Campagne sans rôle clair — budget mieux utilisé dans les nouvelles campagnes.',
        harvestedKeywords: [...new Set(harvestedKeywords)],
        harvestedAsins: [...new Set(harvestedAsins)],
      });

      totalBudgetToSave += campaign.dailyBudget || 0;
    }

    if (campaignsToPause.length === 0) return undefined;

    return { campaignsToPause, totalBudgetToSave };
  }

  // ── Plan fingerprint ──────────────────────────────────────────

  private computePlanFingerprint(ctx: TopFocusContext, campaigns: CampaignToCreate[]): string {
    const data = JSON.stringify({
      bookId: ctx.bookContext.id,
      lifecycle: ctx.bookContext.lifecyclePhase,
      scenario: ctx.scenario,
      gaps: (ctx.gaps || []).map(g => g.type).sort(),
      campaigns: campaigns.map(c => ({
        type: c.type,
        targetingMode: c.targetingMode,
        keywords: (c.seedKeywords || []).slice().sort(),
        asins: (c.seedAsins || []).slice().sort(),
      })),
    });
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  // ── Helpers ───────────────────────────────────────────────────

  private hasBasicCampaignStructure(ctx: TopFocusContext): boolean {
    const types = this.getExistingCampaignTypes(ctx);
    return types.has('auto') && (types.has('exact') || types.has('phrase'));
  }

  private getExistingCampaignTypes(ctx: TopFocusContext): Set<string> {
    const types = new Set<string>();
    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      if (c.targetingType === 'auto') types.add('auto');
      for (const ag of c.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state !== 'archived') types.add(kw.matchType);
        }
        if (ag.targets.length > 0) types.add('product');
      }
    }
    return types;
  }

  private needsDedicatedExactCampaign(ctx: TopFocusContext): boolean {
    const winnerKeys = new Set<string>();
    for (const [, insights] of ctx.entityInsightsMap) {
      for (const insight of insights) {
        if (insight.diagnosisCode === 'winner') winnerKeys.add(insight.entityKey);
      }
    }

    if (winnerKeys.size === 0) return false;

    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      const exactKws = c.adGroups.flatMap(ag =>
        ag.keywords.filter(k => k.matchType === 'exact' && k.state !== 'archived'),
      );
      const winnerInExact = exactKws.filter(k => winnerKeys.has(`keyword:${k.id}`));
      if (winnerInExact.length >= winnerKeys.size * 0.5) return false;
    }

    return true;
  }

  private hasProductTargeting(ctx: TopFocusContext): boolean {
    return ctx.campaigns.some(c =>
      c.state !== 'archived' && c.adGroups.some(ag => ag.targets.length > 0),
    );
  }

  private extractWinnerKeywordTexts(ctx: TopFocusContext): string[] {
    const texts: string[] = [];
    for (const c of ctx.campaigns) {
      for (const ag of c.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state === 'archived') continue;
          const key = `keyword:${kw.id}`;
          const insights = ctx.entityInsightsMap.get(c.id) || [];
          if (insights.some(i => i.entityKey === key && i.diagnosisCode === 'winner')) {
            texts.push(kw.keywordText);
          }
        }
      }
    }
    return [...new Set(texts)];
  }

  private inferSeedKeywords(ctx: TopFocusContext): string[] {
    const title = ctx.bookContext.title || '';
    const words = title
      .toLowerCase()
      .replace(/[^a-zàâéèêëïîôùûüç\s-]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);
    return words.length > 0 ? words.slice(0, 5) : [];
  }
}
