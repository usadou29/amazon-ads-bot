import { Injectable, Logger } from '@nestjs/common';
import type {
  TopFocusContext,
  HarvestedAssets,
  CampaignToCreate,
  CampaignExplanation,
  CampaignPlanType,
  BiddingStrategy,
} from '../campaign-evolution.types';
import {
  LIFECYCLE_DEFAULT_BIDS,
  STRATEGIC_BUDGETS,
  LIFECYCLE_BID_STRATEGY,
  BID_GUARDS,
} from '../constants';

/**
 * ResetPlanBuilder — Mode RESET
 *
 * Builds a creation plan from SCRATCH. ZERO historical data recovery.
 * Uses only lifecycle defaults + userProvidedKeywords (from book title).
 *
 * Structure per lifecycle:
 *
 * LAUNCH:
 *   - SP Auto (UP_DOWN)
 *   - SP Expression if userProvidedKeywords exist
 *   - NO SP Exact (not enough data yet)
 *
 * SCALE:
 *   - SP Auto
 *   - SP Expression
 *   - SP Exact if userProvidedKeywords exist
 *
 * EVERGREEN:
 *   - SP Exact (priority — high-intent traffic)
 *   - SP Product
 *   - SP Auto (lower budget)
 *
 * RELAUNCH: same as LAUNCH
 */
@Injectable()
export class ResetPlanBuilderService {
  private readonly logger = new Logger(ResetPlanBuilderService.name);

  /**
   * Build a reset plan. Only uses userProvidedKeywords from harvest
   * (inferred from book title). All other harvest data is IGNORED.
   */
  buildPlan(ctx: TopFocusContext, harvest: HarvestedAssets): CampaignToCreate[] {
    const bookTitle = (ctx.bookContext.title || ctx.bookContext.asin || 'Livre').slice(0, 25);
    const lifecycle = (ctx.bookContext.lifecyclePhase || 'launch') as string;
    const userKeywords = harvest.userProvidedKeywords;

    switch (lifecycle) {
      case 'scale':
        return this.buildScalePlan(bookTitle, lifecycle, userKeywords);
      case 'evergreen':
        return this.buildEvergreenPlan(bookTitle, lifecycle, userKeywords);
      case 'relaunch':
        return this.buildLaunchPlan(bookTitle, lifecycle, userKeywords);
      case 'launch':
      default:
        return this.buildLaunchPlan(bookTitle, lifecycle, userKeywords);
    }
  }

  // ── LAUNCH / RELAUNCH ────────────────────────────────────────

  private buildLaunchPlan(bookTitle: string, lifecycle: string, userKeywords: string[]): CampaignToCreate[] {
    const result: CampaignToCreate[] = [];
    const budgets = STRATEGIC_BUDGETS[lifecycle] || STRATEGIC_BUDGETS.launch;
    const bidStrategies = LIFECYCLE_BID_STRATEGY[lifecycle] || LIFECYCLE_BID_STRATEGY.launch;
    const defaultBid = LIFECYCLE_DEFAULT_BIDS[lifecycle] || LIFECYCLE_DEFAULT_BIDS.launch;

    // SP Auto (UP_DOWN)
    const autoBudget = budgets['SP_AUTO'] || budgets['default'];
    const autoStrategy = (bidStrategies['SP_AUTO'] || bidStrategies['default']) as BiddingStrategy;

    result.push({
      name: `${bookTitle}-SP-Auto`,
      type: 'SP_AUTO',
      targetingMode: 'AUTO',
      dailyBudget: autoBudget,
      defaultBid: this.clampBid(defaultBid * 0.9),
      biddingStrategy: autoStrategy,
      notesWhy: 'Campagne de découverte — laisse Amazon trouver les bons mots-clés pour ton livre.',
      explanations: [
        this.explainType('SP_AUTO'),
        this.explainBid(this.clampBid(defaultBid * 0.9), lifecycle),
        this.explainBudget(autoBudget, lifecycle, 'SP_AUTO'),
        this.explainStrategy(autoStrategy),
      ],
    });

    // SP Expression if userProvidedKeywords exist
    if (userKeywords.length > 0) {
      const broadBudget = budgets['SP_MANUAL_BROAD'] || budgets['default'];
      const broadStrategy = (bidStrategies['SP_MANUAL_BROAD'] || bidStrategies['default']) as BiddingStrategy;

      result.push({
        name: `${bookTitle}-SP-Expression`,
        type: 'SP_MANUAL_BROAD',
        targetingMode: 'MANUAL',
        dailyBudget: broadBudget,
        defaultBid: this.clampBid(defaultBid),
        biddingStrategy: broadStrategy,
        seedKeywords: userKeywords.slice(0, 25),
        notesWhy: `Ciblage large sur ${userKeywords.length} termes inférés du titre — explore les variantes.`,
        explanations: [
          this.explainType('SP_MANUAL_BROAD'),
          this.explainBid(this.clampBid(defaultBid), lifecycle),
          this.explainBudget(broadBudget, lifecycle, 'SP_MANUAL_BROAD'),
          this.explainStrategy(broadStrategy),
          this.explainKeywords(userKeywords.length, 'inferred'),
        ],
      });
    }

    this.logger.debug(`RESET launch plan: ${result.length} campaigns for "${bookTitle}"`);
    return result;
  }

  // ── SCALE ────────────────────────────────────────────────────

  private buildScalePlan(bookTitle: string, lifecycle: string, userKeywords: string[]): CampaignToCreate[] {
    const result: CampaignToCreate[] = [];
    const budgets = STRATEGIC_BUDGETS[lifecycle] || STRATEGIC_BUDGETS.scale;
    const bidStrategies = LIFECYCLE_BID_STRATEGY[lifecycle] || LIFECYCLE_BID_STRATEGY.scale;
    const defaultBid = LIFECYCLE_DEFAULT_BIDS[lifecycle] || LIFECYCLE_DEFAULT_BIDS.scale;

    // SP Auto
    const autoBudget = budgets['SP_AUTO'] || budgets['default'];
    const autoStrategy = (bidStrategies['SP_AUTO'] || bidStrategies['default']) as BiddingStrategy;

    result.push({
      name: `${bookTitle}-SP-Auto`,
      type: 'SP_AUTO',
      targetingMode: 'AUTO',
      dailyBudget: autoBudget,
      defaultBid: this.clampBid(defaultBid * 0.9),
      biddingStrategy: autoStrategy,
      notesWhy: 'Campagne de découverte automatique — complément aux campagnes manuelles.',
      explanations: [
        this.explainType('SP_AUTO'),
        this.explainBid(this.clampBid(defaultBid * 0.9), lifecycle),
        this.explainBudget(autoBudget, lifecycle, 'SP_AUTO'),
        this.explainStrategy(autoStrategy),
      ],
    });

    // SP Expression
    if (userKeywords.length > 0) {
      const broadBudget = budgets['SP_MANUAL_BROAD'] || budgets['default'];
      const broadStrategy = (bidStrategies['SP_MANUAL_BROAD'] || bidStrategies['default']) as BiddingStrategy;

      result.push({
        name: `${bookTitle}-SP-Expression`,
        type: 'SP_MANUAL_BROAD',
        targetingMode: 'MANUAL',
        dailyBudget: broadBudget,
        defaultBid: this.clampBid(defaultBid),
        biddingStrategy: broadStrategy,
        seedKeywords: userKeywords.slice(0, 25),
        notesWhy: `Ciblage large sur ${userKeywords.length} termes — découverte de variantes performantes.`,
        explanations: [
          this.explainType('SP_MANUAL_BROAD'),
          this.explainBid(this.clampBid(defaultBid), lifecycle),
          this.explainBudget(broadBudget, lifecycle, 'SP_MANUAL_BROAD'),
          this.explainStrategy(broadStrategy),
          this.explainKeywords(userKeywords.length, 'inferred'),
        ],
      });

      // SP Exact (scale only)
      const exactBudget = budgets['SP_MANUAL_EXACT'] || budgets['default'];
      const exactStrategy = (bidStrategies['SP_MANUAL_EXACT'] || bidStrategies['default']) as BiddingStrategy;

      result.push({
        name: `${bookTitle}-SP-Exact`,
        type: 'SP_MANUAL_EXACT',
        targetingMode: 'MANUAL',
        dailyBudget: exactBudget,
        defaultBid: this.clampBid(defaultBid),
        biddingStrategy: exactStrategy,
        seedKeywords: userKeywords.slice(0, 20),
        notesWhy: `Ciblage exact sur ${Math.min(userKeywords.length, 20)} termes — conversion maximale.`,
        explanations: [
          this.explainType('SP_MANUAL_EXACT'),
          this.explainBid(this.clampBid(defaultBid), lifecycle),
          this.explainBudget(exactBudget, lifecycle, 'SP_MANUAL_EXACT'),
          this.explainStrategy(exactStrategy),
          this.explainKeywords(Math.min(userKeywords.length, 20), 'inferred'),
        ],
      });
    }

    this.logger.debug(`RESET scale plan: ${result.length} campaigns for "${bookTitle}"`);
    return result;
  }

  // ── EVERGREEN ────────────────────────────────────────────────

  private buildEvergreenPlan(bookTitle: string, lifecycle: string, userKeywords: string[]): CampaignToCreate[] {
    const result: CampaignToCreate[] = [];
    const budgets = STRATEGIC_BUDGETS[lifecycle] || STRATEGIC_BUDGETS.evergreen;
    const bidStrategies = LIFECYCLE_BID_STRATEGY[lifecycle] || LIFECYCLE_BID_STRATEGY.evergreen;
    const defaultBid = LIFECYCLE_DEFAULT_BIDS[lifecycle] || LIFECYCLE_DEFAULT_BIDS.evergreen;

    // SP Exact (priority in evergreen)
    if (userKeywords.length > 0) {
      const exactBudget = budgets['SP_MANUAL_EXACT'] || budgets['default'];
      const exactStrategy = (bidStrategies['SP_MANUAL_EXACT'] || bidStrategies['default']) as BiddingStrategy;

      result.push({
        name: `${bookTitle}-SP-Exact`,
        type: 'SP_MANUAL_EXACT',
        targetingMode: 'MANUAL',
        dailyBudget: exactBudget,
        defaultBid: this.clampBid(defaultBid),
        biddingStrategy: exactStrategy,
        seedKeywords: userKeywords.slice(0, 20),
        notesWhy: `Exact prioritaire — en croisière, on mise sur la conversion avec ${Math.min(userKeywords.length, 20)} termes ciblés.`,
        explanations: [
          this.explainType('SP_MANUAL_EXACT'),
          this.explainBid(this.clampBid(defaultBid), lifecycle),
          this.explainBudget(exactBudget, lifecycle, 'SP_MANUAL_EXACT'),
          this.explainStrategy(exactStrategy),
          this.explainKeywords(Math.min(userKeywords.length, 20), 'inferred'),
        ],
      });
    }

    // SP Product (no ASINs in reset mode — placeholder for manual input)
    const productBudget = budgets['SP_PRODUCT'] || budgets['default'];
    const productStrategy = (bidStrategies['SP_PRODUCT'] || bidStrategies['default']) as BiddingStrategy;

    result.push({
      name: `${bookTitle}-SP-Product`,
      type: 'SP_PRODUCT',
      targetingMode: 'MANUAL',
      dailyBudget: productBudget,
      defaultBid: this.clampBid(defaultBid),
      biddingStrategy: productStrategy,
      seedAsins: [], // User will need to add ASINs manually
      notesWhy: 'Ciblage produit — ajoute manuellement les ASINs de livres similaires au tien.',
      explanations: [
        this.explainType('SP_PRODUCT'),
        this.explainBid(this.clampBid(defaultBid), lifecycle),
        this.explainBudget(productBudget, lifecycle, 'SP_PRODUCT'),
        this.explainStrategy(productStrategy),
        { parameter: 'asins', value: '0 ASINs (à ajouter)', reasoning: 'En mode Reset, aucun ASIN historique n\'est récupéré. Tu devras ajouter manuellement les ASINs de livres similaires.', dataSource: 'rule_based' },
      ],
    });

    // SP Auto (lower budget for evergreen)
    const autoBudget = Math.max(budgets['SP_AUTO'] || budgets['default'], 5);
    const autoStrategy = (bidStrategies['SP_AUTO'] || bidStrategies['default']) as BiddingStrategy;

    result.push({
      name: `${bookTitle}-SP-Auto`,
      type: 'SP_AUTO',
      targetingMode: 'AUTO',
      dailyBudget: Math.min(autoBudget, 8), // Cap auto budget low in evergreen
      defaultBid: this.clampBid(defaultBid * 0.8),
      biddingStrategy: autoStrategy,
      notesWhy: 'Auto en maintenance — budget réduit, juste pour continuer à découvrir des termes.',
      explanations: [
        this.explainType('SP_AUTO'),
        this.explainBid(this.clampBid(defaultBid * 0.8), lifecycle),
        this.explainBudget(Math.min(autoBudget, 8), lifecycle, 'SP_AUTO'),
        this.explainStrategy(autoStrategy),
      ],
    });

    this.logger.debug(`RESET evergreen plan: ${result.length} campaigns for "${bookTitle}"`);
    return result;
  }

  // ── Helpers ──────────────────────────────────────────────────

  private clampBid(bid: number): number {
    return Math.round(Math.max(BID_GUARDS.absoluteMin, Math.min(BID_GUARDS.absoluteMax, bid)) * 100) / 100;
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
      reasoning: typeExplanations[type] || 'Type de campagne sélectionné.',
      dataSource: 'rule_based',
    };
  }

  private explainBid(bid: number, lifecycle: string): CampaignExplanation {
    return {
      parameter: 'bid',
      value: `${bid.toFixed(2)}€`,
      reasoning: `Enchère par défaut pour la phase "${lifecycle}". Sera ajustée automatiquement par Amazon selon la compétition.`,
      dataSource: 'lifecycle_default',
    };
  }

  private explainBudget(budget: number, lifecycle: string, type: string): CampaignExplanation {
    const labels: Record<string, string> = { launch: 'lancement', scale: 'croissance', evergreen: 'croisière', relaunch: 'relancement' };
    return {
      parameter: 'budget',
      value: `${budget}€/jour`,
      reasoning: `Budget par défaut pour la phase ${labels[lifecycle] || lifecycle}. Suffisant pour collecter des données initiales.`,
      dataSource: 'lifecycle_default',
    };
  }

  private explainStrategy(strategy: BiddingStrategy): CampaignExplanation {
    const labels: Record<string, string> = { UP_DOWN: 'Ajustement dynamique (Up & Down)', DOWN_ONLY: 'Réduction uniquement (Down Only)', FIXED: 'Enchère fixe' };
    const reasons: Record<string, string> = {
      UP_DOWN: 'Amazon peut augmenter ou diminuer ton enchère selon la probabilité de conversion.',
      DOWN_ONLY: 'Amazon ne peut que baisser ton enchère. Protège ton budget.',
      FIXED: 'Enchère fixe, pas d\'ajustement automatique.',
    };
    return {
      parameter: 'biddingStrategy',
      value: labels[strategy] || strategy,
      reasoning: reasons[strategy] || 'Stratégie sélectionnée selon ta phase de vie.',
      dataSource: 'lifecycle_default',
    };
  }

  private explainKeywords(count: number, source: string): CampaignExplanation {
    return {
      parameter: 'keywords',
      value: `${count} mots-clés`,
      reasoning: `${count} termes inférés du titre de ton livre. Ce sont des mots-clés de départ — les données réelles viendront ensuite.`,
      dataSource: 'inferred',
    };
  }
}
