import { Injectable, Logger } from '@nestjs/common';
import type {
  TopFocusContext,
  HarvestedAssets,
  CampaignToCreate,
  CampaignExplanation,
  CampaignPlanType,
  BiddingStrategy,
  PlacementAdjustments,
} from '../campaign-evolution.types';
import {
  LIFECYCLE_DEFAULT_BIDS,
  STRATEGIC_BUDGETS,
  LIFECYCLE_BID_STRATEGY,
  BID_GUARDS,
  PLACEMENT_PERFORMANCE_THRESHOLD,
  PLACEMENT_TOP_OF_SEARCH_BOOST_MIN,
  PLACEMENT_TOP_OF_SEARCH_BOOST_MAX,
} from '../constants';

/**
 * HarvestPlanBuilder — Mode HARVEST
 *
 * Builds a creation plan by RECOVERING data from existing campaigns.
 * Uses real winner keywords, ASINs, negatives, bids, and placement data.
 *
 * Rules:
 * 1. SP Auto always (if absent)
 * 2. SP Expression if seeds exist (winners + search terms + user keywords)
 * 3. SP Exact if winners exist
 * 4. SP Product if winner ASINs exist
 * Never creates duplicate campaign types.
 *
 * Bid: avgWinningBid (winners), avgCpcObserved (manual), lifecycle default (fallback)
 * Placement: boost only if CVR TopOfSearch > CVR RestOfSearch
 */
@Injectable()
export class HarvestPlanBuilderService {
  private readonly logger = new Logger(HarvestPlanBuilderService.name);

  buildPlan(ctx: TopFocusContext, harvest: HarvestedAssets): CampaignToCreate[] {
    const bookTitle = (ctx.bookContext.title || ctx.bookContext.asin || 'Livre').slice(0, 25);
    const lifecycle = (ctx.bookContext.lifecyclePhase || 'launch') as string;
    const result: CampaignToCreate[] = [];
    const existingTypes = this.getExistingCampaignTypes(ctx);

    // Shared parameters
    const bid = this.computeBid(lifecycle, harvest);
    const budgets = STRATEGIC_BUDGETS[lifecycle] || STRATEGIC_BUDGETS.launch;
    const bidStrategies = LIFECYCLE_BID_STRATEGY[lifecycle] || LIFECYCLE_BID_STRATEGY.launch;
    const placementAdj = this.computePlacements(harvest);

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
        biddingStrategy: autoStrategy as BiddingStrategy,
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

    // ── 2. SP Expression (if seeds exist) ──────────
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
        biddingStrategy: broadStrategy as BiddingStrategy,
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
        biddingStrategy: exactStrategy as BiddingStrategy,
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
        biddingStrategy: productStrategy as BiddingStrategy,
        seedAsins: harvest.winnerAsins,
        notesWhy: `Cible ${harvest.winnerAsins.length} fiches produit similaires — trafic qualifié.`,
        explanations: [
          this.explainType('SP_PRODUCT'),
          this.explainBid(bid.manual, bid.source, 'product'),
          this.explainBudget(productBudget, lifecycle, 'SP_PRODUCT'),
          this.explainStrategy(productStrategy, lifecycle, 'SP_PRODUCT'),
          { parameter: 'asins', value: `${harvest.winnerAsins.length} ASINs`, reasoning: 'ASINs identifiés comme performants dans tes campagnes existantes.', dataSource: 'real_data' },
        ],
      });
    }

    this.logger.debug(`HARVEST plan: ${result.length} campaigns for "${bookTitle}" (${lifecycle})`);
    return result;
  }

  // ── Bid Computation ──────────────────────────────────────────

  /**
   * Bid rules (per spec):
   *   - If winners exist: bid = avgWinningBid (no multiplier)
   *   - Otherwise: bid = avgCpcObserved
   *   - Fallback: lifecycle default
   */
  private computeBid(lifecycle: string, harvest: HarvestedAssets): {
    auto: number;
    manual: number;
    winners: number | null;
    source: string;
    winnersSource: string | null;
  } {
    const fallback = LIFECYCLE_DEFAULT_BIDS[lifecycle] || LIFECYCLE_DEFAULT_BIDS.launch;

    // Winners bid: use avgWinningBid directly (no multiplier per new spec)
    let winners: number | null = null;
    let winnersSource: string | null = null;
    if (harvest.avgWinningBid !== null) {
      winners = this.clampBid(harvest.avgWinningBid);
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

  // ── Placement Computation ────────────────────────────────────

  /**
   * Placement boost: ONLY if CVR TopOfSearch > CVR RestOfSearch (ratio > 1.0)
   * Otherwise: 0% (no boost)
   * Formula: linear scale from 20% at ratio 1.0 to 40% at ratio 2.0+
   */
  private computePlacements(harvest: HarvestedAssets): PlacementAdjustments | undefined {
    if (harvest.topPlacementPerformance === null || harvest.topPlacementPerformance <= PLACEMENT_PERFORMANCE_THRESHOLD) {
      return undefined;
    }

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

  // ── Keyword Merge ────────────────────────────────────────────

  private mergeKeywordsForBroad(harvest: HarvestedAssets): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

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

    return result.slice(0, 25);
  }

  private mergeKeywordsForExact(harvest: HarvestedAssets): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const kw of harvest.winnerKeywords) {
      const lower = kw.text.toLowerCase();
      if (!seen.has(lower)) { seen.add(lower); result.push(kw.text); }
    }
    for (const st of harvest.winnerSearchTerms) {
      const lower = st.query.toLowerCase();
      if (!seen.has(lower)) { seen.add(lower); result.push(st.query); }
    }

    return result.slice(0, 20);
  }

  // ── Helpers ──────────────────────────────────────────────────

  private getExistingCampaignTypes(ctx: TopFocusContext): Set<string> {
    const types = new Set<string>();
    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      if (c.targetingType === 'auto' || c.targetingType === 'AUTO') types.add('auto');
      for (const ag of c.adGroups) {
        if (ag.keywords.some(k => k.matchType === 'broad' && k.state !== 'archived')) types.add('broad');
        if (ag.keywords.some(k => k.matchType === 'exact' && k.state !== 'archived')) types.add('exact');
        if (ag.targets.some(t => t.expressionType === 'asinSameAs' && t.state !== 'archived')) types.add('product');
      }
    }
    return types;
  }

  private hasExactForWinners(ctx: TopFocusContext): boolean {
    // Check if existing campaigns already have an Exact campaign
    // that covers most of the winner keywords. If no existing exact
    // campaigns exist at all, return false (= we need to create one).
    const winnerKeys = new Set<string>();
    for (const [, insights] of ctx.entityInsightsMap) {
      for (const insight of insights) {
        if (insight.entityKey.startsWith('keyword:') && insight.summaryFacts.orders >= 1) {
          winnerKeys.add(insight.entityKey);
        }
      }
    }

    // No winner keys in insights → we can't verify coverage, so default to NOT covered
    // (the caller already knows winners exist from harvest data)
    if (winnerKeys.size === 0) return false;

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

  // ── Explanation Generators ───────────────────────────────────

  private explainType(type: CampaignPlanType): CampaignExplanation {
    const typeExplanations: Record<string, string> = {
      SP_AUTO: 'Amazon choisit automatiquement les requêtes. Idéal pour découvrir de nouveaux mots-clés sans effort.',
      SP_MANUAL_BROAD: 'Ciblage large (Expression) : tes mots-clés + variantes proches. Bon compromis découverte/contrôle.',
      SP_MANUAL_EXACT: 'Ciblage Exact : tes mots-clés uniquement, sans variante. Conversion maximale, contrôle total.',
      SP_PRODUCT: 'Ciblage produit : affiche ton livre sur les fiches de livres similaires. Trafic très qualifié.',
      SP_CATEGORY: 'Ciblage catégorie : explore un public large dans ta niche Amazon.',
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
      reasoning = 'Enchère basée sur le CPC réel de tes gagnants. Tu paies le juste prix pour garder la position sur tes meilleurs termes.';
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
    const labels: Record<string, string> = { launch: 'lancement', scale: 'croissance', evergreen: 'croisière', relaunch: 'relancement' };
    return {
      parameter: 'budget',
      value: `${budget}€/jour`,
      reasoning: `Budget adapté à la phase ${labels[lifecycle] || lifecycle} pour une campagne ${type}. Assez pour collecter des données sans gaspiller.`,
      dataSource: 'rule_based',
    };
  }

  private explainStrategy(strategy: string, lifecycle: string, type: string): CampaignExplanation {
    const labels: Record<string, string> = { UP_DOWN: 'Ajustement dynamique (Up & Down)', DOWN_ONLY: 'Réduction uniquement (Down Only)', FIXED: 'Enchère fixe' };
    const reasons: Record<string, string> = {
      UP_DOWN: 'Amazon peut augmenter ou diminuer ton enchère selon la probabilité de conversion. Plus agressif, idéal en phase de découverte ou pour les gagnants.',
      DOWN_ONLY: 'Amazon ne peut que baisser ton enchère. Protège ton budget tout en restant compétitif.',
      FIXED: 'Enchère fixe, pas d\'ajustement automatique. Maximum de contrôle.',
    };

    return {
      parameter: 'biddingStrategy',
      value: labels[strategy] || strategy,
      reasoning: reasons[strategy] || 'Stratégie sélectionnée selon ta phase de vie et le type de campagne.',
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
      reasoning: 'Termes ayant reçu 15+ clics sans aucune conversion. Les bloquer protège ton budget.',
      dataSource: 'real_data',
    };
  }
}
