import { Injectable, Logger } from '@nestjs/common';
import type { LifecyclePhase } from '@/db/schema/books';
import { GUARDS } from '@/config/guards';

/**
 * StrategyEngine — Post-processing layer above the RulesEngine.
 *
 * The RulesEngine generates recommendations.
 * The StrategyEngine then scores, labels, and tags each recommendation
 * based on the book's lifecycle phase, using a scoring matrix.
 *
 * Key principles:
 * - NEVER delete a recommendation — all stay visible
 * - The highest-scored reco per entityKey gets `recommendedForLifecycle = true`
 * - Others become labeled alternatives (prudent / aggressive / secondary)
 * - Launch phase has consent guards for expensive actions
 */

// ─── Types ───────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high';
export type ConsentLevel = 'none' | 'basic' | 'reinforced';

export interface StrategyInput {
  id: string;
  entityKey: string;
  entityType: string;
  actionType: string;
  contextData?: Record<string, any>;
  confidenceScore?: number | null;
}

export interface StrategyResult {
  id: string;
  strategyScore: number;          // 0-100
  strategyLabel: string;          // e.g., "Recommandé en Scaling"
  riskLevel: RiskLevel;
  recommendedForLifecycle: boolean;
  requiresConsent: boolean;
  consentLevel: ConsentLevel;
  consentMessage?: string;        // Message pédagogique si consentement requis
}

// ─── Economic Context ───────────────────────────────

export interface StrategyContext {
  royaltyRate?: number;        // Royalty rate du livre (ex: 35 = 35%)
  defaultRoyaltyRate: number;  // Fallback (GUARDS.DEFAULT_ROYALTY_RATE)
}

type ProfitZone = 'profitable' | 'optimization' | 'exploration' | 'unprofitable';

interface ProfitAnalysis {
  breakEvenAcos: number;       // = royaltyRate
  profitRatio: number;         // acos / breakEvenAcos (Infinity si pas d'ACoS)
  zone: ProfitZone;
}

// ─── Scoring Matrix ──────────────────────────────────

/**
 * Matrix: actionCategory × lifecycle → base score (0-100)
 * Score final 70+ = recommended.
 */
type ActionCategory =
  | 'pause'
  | 'bid_down'
  | 'bid_up'
  | 'add_negative'
  | 'harvest'
  | 'budget_increase'
  | 'optimize_placement'
  | 'patience'        // launch_high_acos_patience: wait and see
  | 'book_advice';    // cover/page optimization

interface ScoreEntry {
  base: number;
  riskPenalty?: number; // Subtracted from base in this lifecycle
}

const SCORING_MATRIX: Record<ActionCategory, Record<LifecyclePhase, ScoreEntry>> = {
  pause: {
    launch:    { base: 20,  riskPenalty: -50 },
    scale:     { base: 70,  riskPenalty: -10 },
    evergreen: { base: 95,  riskPenalty: 0 },
    relaunch:  { base: 50,  riskPenalty: -20 },
  },
  bid_down: {
    launch:    { base: 60,  riskPenalty: 0 },
    scale:     { base: 85,  riskPenalty: 0 },
    evergreen: { base: 70,  riskPenalty: 0 },
    relaunch:  { base: 75,  riskPenalty: 0 },
  },
  bid_up: {
    launch:    { base: 82,  riskPenalty: 0 },
    scale:     { base: 95,  riskPenalty: 0 },
    evergreen: { base: 65,  riskPenalty: -20 },
    relaunch:  { base: 87,  riskPenalty: 0 },
  },
  add_negative: {
    launch:    { base: 30,  riskPenalty: -10 },
    scale:     { base: 80,  riskPenalty: 0 },
    evergreen: { base: 95,  riskPenalty: 0 },
    relaunch:  { base: 70,  riskPenalty: 0 },
  },
  harvest: {
    launch:    { base: 92,  riskPenalty: 0 },
    scale:     { base: 100, riskPenalty: 0 },
    evergreen: { base: 65,  riskPenalty: 0 },
    relaunch:  { base: 92,  riskPenalty: 0 },
  },
  budget_increase: {
    launch:    { base: 75,  riskPenalty: 0 },
    scale:     { base: 90,  riskPenalty: 0 },
    evergreen: { base: 50,  riskPenalty: -10 },
    relaunch:  { base: 80,  riskPenalty: 0 },
  },
  optimize_placement: {
    launch:    { base: 25,  riskPenalty: 0 },
    scale:     { base: 85,  riskPenalty: 0 },
    evergreen: { base: 75,  riskPenalty: 0 },
    relaunch:  { base: 60,  riskPenalty: 0 },
  },
  patience: {
    launch:    { base: 90,  riskPenalty: 0 },
    scale:     { base: 40,  riskPenalty: 0 },
    evergreen: { base: 20,  riskPenalty: 0 },
    relaunch:  { base: 70,  riskPenalty: 0 },
  },
  book_advice: {
    launch:    { base: 85,  riskPenalty: 0 },
    scale:     { base: 70,  riskPenalty: 0 },
    evergreen: { base: 55,  riskPenalty: 0 },
    relaunch:  { base: 90,  riskPenalty: 0 },
  },
};

// ─── Phase Labels ────────────────────────────────────

const PHASE_LABELS: Record<LifecyclePhase, string> = {
  launch: 'Lancement',
  scale: 'Croissance',
  evergreen: 'Croisière',
  relaunch: 'Relance',
};

// ─── Consent Messages ────────────────────────────────

const CONSENT_MESSAGES = {
  basic: (actionDesc: string) =>
    `En phase de lancement, on explore. ${actionDesc} peut coûter sans ventes immédiates au début — c'est attendu. L'algorithme Amazon a besoin de données pour apprendre.`,
  reinforced: (spendAmount: string, limitAmount: string) =>
    `Attention : tes dépenses en lancement ont atteint ${spendAmount}. Ta limite est de ${limitAmount} sur 7 jours. Confirme que tu acceptes de continuer à investir au-delà de cette limite.`,
};

// ─── Engine ──────────────────────────────────────────

@Injectable()
export class StrategyEngine {
  private readonly logger = new Logger(StrategyEngine.name);

  // ─── Economic Analysis Methods ─────────────────────

  /**
   * Calcule le break-even ACoS à partir du royalty rate.
   * Break-even ACoS = royalty rate (au-delà, on perd de l'argent).
   */
  private calculateBreakEvenAcos(context?: StrategyContext): number {
    const rate = context?.royaltyRate ?? context?.defaultRoyaltyRate ?? GUARDS.DEFAULT_ROYALTY_RATE;
    return Math.max(5, Math.min(100, rate));
  }

  /**
   * Classifie la zone de profit d'un mot-clé/cible.
   *
   * - profitable:    ratio ≤ 0.8  → bonne marge, on peut investir plus
   * - optimization:  0.8 < ratio ≤ 1.2  → près du break-even, optimiser
   * - exploration:   1.2 < ratio ≤ 1.6 ET orders > 0  → risqué mais data
   * - unprofitable:  ratio > 1.6 OU (ratio > 1.2 ET orders === 0)
   */
  private classifyProfitZone(acos: number, breakEvenAcos: number, orders: number): ProfitAnalysis {
    // Si pas d'ACoS (pas de ventes), c'est unprofitable
    if (!acos || acos <= 0) {
      return {
        breakEvenAcos,
        profitRatio: orders > 0 ? 0 : Infinity,
        zone: orders > 0 ? 'profitable' : 'unprofitable',
      };
    }

    const profitRatio = acos / breakEvenAcos;

    let zone: ProfitZone;
    if (profitRatio <= 0.8) {
      zone = 'profitable';
    } else if (profitRatio <= 1.2) {
      zone = 'optimization';
    } else if (profitRatio <= 1.6 && orders > 0) {
      zone = 'exploration';
    } else {
      zone = 'unprofitable';
    }

    return { breakEvenAcos, profitRatio, zone };
  }

  /**
   * HARD GUARD : détermine si une pause doit être bloquée.
   *
   * Règles :
   * - orders >= 3 ET acos <= breakEven * 1.2  → TOUJOURS bloquer
   * - Pause autorisée SEULEMENT si :
   *   - (orders === 0 ET clicks >= MIN_CLICKS) → pas de data, assez de clics
   *   - OU (acos >= breakEven * 1.6 ET clicks >= MIN_CLICKS) → waste clair
   * - Sinon → bloquer (pénalité de score)
   *
   * @returns penalty: nombre à soustraire du score (0 = pas de blocage)
   */
  private computePauseGuardPenalty(
    category: ActionCategory,
    metrics: Record<string, any>,
    profitAnalysis: ProfitAnalysis,
  ): number {
    if (category !== 'pause') return 0;

    const orders = Number(metrics.orders || 0);
    const clicks = Number(metrics.clicks || 0);
    const acos = Number(metrics.acos || 0);
    const minClicks = GUARDS.MIN_CLICKS_FOR_DECISION;

    // HARD GUARD : mot-clé rentable ou proche du break-even avec commandes
    if (orders >= 3 && acos > 0 && acos <= profitAnalysis.breakEvenAcos * 1.2) {
      return 60; // Blocage fort — ne devrait JAMAIS être recommandé
    }

    // Pause clairement autorisée : pas de commandes et assez de clics
    if (orders === 0 && clicks >= minClicks) {
      return 0; // Pas de pénalité, la pause est légitime
    }

    // Pause clairement autorisée : waste évident (ACoS >= 1.6x break-even)
    if (acos >= profitAnalysis.breakEvenAcos * 1.6 && clicks >= minClicks) {
      return 0; // Pas de pénalité, la pause est légitime
    }

    // Sinon : pénalité proportionnelle aux commandes
    if (orders > 0) {
      return 40; // A des commandes mais pas dans les cas clairs → bloquer
    }

    return 0; // Pas assez de data pour décider → laisser le score de base
  }

  /**
   * Calcule les ajustements de score basés sur la zone de profit.
   * Appliqué APRÈS le base score + riskPenalty, AVANT le contextBonus.
   */
  private computeProfitZoneAdjustment(
    category: ActionCategory,
    profitAnalysis: ProfitAnalysis,
    orders: number,
  ): number {
    let adjustment = 0;

    switch (profitAnalysis.zone) {
      case 'profitable':
        // Zone rentable : favoriser l'investissement
        if (category === 'bid_up') adjustment += 20;
        if (category === 'harvest') adjustment += 15;
        if (category === 'pause') adjustment -= 30;
        break;

      case 'optimization':
        // Zone d'optimisation : favoriser bid_down, pénaliser pause
        if (category === 'bid_down') adjustment += 15;
        if (category === 'pause') adjustment -= 25;
        break;

      case 'exploration':
        // Zone exploration : monitoring, pas de bonus fort
        if (category === 'bid_down') adjustment += 5;
        break;

      case 'unprofitable':
        // Zone non rentable : logique existante suffit
        break;
    }

    // Pénalité globale pause si le mot-clé a des commandes
    if (category === 'pause' && orders > 0 && profitAnalysis.zone !== 'unprofitable') {
      adjustment -= 15;
    }

    return adjustment;
  }

  /**
   * Classifie un actionType en catégorie de la matrice.
   */
  private categorizeAction(actionType: string): ActionCategory {
    const at = actionType.toLowerCase();

    // Patience (attendre)
    if (at.includes('patience') || at.includes('wait') || at.includes('no_action')) {
      return 'patience';
    }

    // Pause
    if (at.includes('pause')) {
      return 'pause';
    }

    // Bid down
    if (at.includes('bid_down') || at.includes('lower_bid') || at.includes('acos_tightening')) {
      return 'bid_down';
    }

    // Bid up / boost
    if (at.includes('bid_up') || at.includes('boost') || at.includes('high_performer') || at.includes('shift_budget') || at.includes('low_impressions_bid_up')) {
      return 'bid_up';
    }

    // Add negative
    if (at.includes('negative') || at.includes('unprofitable_search') || at.includes('cleanup') || at.includes('cut_unprofitable')) {
      return 'add_negative';
    }

    // Harvest
    if (at.includes('harvest') || at.includes('profitable_search') || at.includes('profitable_term')) {
      return 'harvest';
    }

    // Budget increase
    if (at.includes('budget') || at.includes('budget_capped')) {
      return 'budget_increase';
    }

    // Placement optimization
    if (at.includes('placement')) {
      return 'optimize_placement';
    }

    // Book advice (cover, page, relaunch)
    if (at.includes('cover') || at.includes('ctr_cover') || at.includes('good_ctr_no_sales') || at.includes('concentration') || at.includes('relaunch_cover')) {
      return 'book_advice';
    }

    // Default: bid_down (conservative)
    return 'bid_down';
  }

  /**
   * Calcule un bonus/malus basé sur les métriques contextuelles.
   */
  private computeContextBonus(category: ActionCategory, metrics: Record<string, any>, phase: LifecyclePhase): number {
    let bonus = 0;
    const clicks = Number(metrics.clicks || 0);
    const orders = Number(metrics.orders || 0);
    const acos = Number(metrics.acos || 0);
    const spend = Number(metrics.spend || 0);
    const sales = Number(metrics.sales || 0);

    switch (category) {
      case 'pause':
        // Plus de clics sans ventes → plus pertinent à pauser
        if (clicks >= 15 && orders === 0) bonus += 10;
        if (acos > 120) bonus += 5;
        break;

      case 'bid_up':
        // CVR élevé et ACOS bas → excellent candidat
        if (metrics.cvr && Number(metrics.cvr) > 5) bonus += 10;
        if (acos > 0 && acos < 30) bonus += 5;
        break;

      case 'harvest':
        // Plus de commandes → plus confiant
        if (orders >= 3) bonus += 10;
        if (orders >= 5) bonus += 5;
        break;

      case 'add_negative':
        // Gros spend sans ventes → urgent
        if (spend > 10 && sales === 0) bonus += 10;
        break;

      case 'patience':
        // En launch avec peu de données → bonus fort
        if (phase === 'launch' && clicks < 30) bonus += 10;
        break;
    }

    return bonus;
  }

  /**
   * Détermine le risk level en fonction du score et de la catégorie.
   */
  private determineRiskLevel(score: number, category: ActionCategory, phase: LifecyclePhase): RiskLevel {
    // Actions naturellement risquées
    if (category === 'bid_up' && phase === 'launch') return 'medium';
    if (category === 'budget_increase' && phase === 'launch') return 'high';
    if (category === 'pause' && phase === 'launch') return 'high';

    // Score-based
    if (score >= 80) return 'low';
    if (score >= 50) return 'medium';
    return 'high';
  }

  /**
   * Détermine le consentement requis.
   * En Launch, les actions qui dépensent plus nécessitent un consentement.
   */
  private determineConsent(
    category: ActionCategory,
    phase: LifecyclePhase,
    _metrics: Record<string, any>,
  ): { requiresConsent: boolean; consentLevel: ConsentLevel; consentMessage?: string } {
    // Hors launch, pas de consentement spécial
    if (phase !== 'launch') {
      return { requiresConsent: false, consentLevel: 'none' };
    }

    // En launch : actions qui augmentent les dépenses
    const spendingActions: ActionCategory[] = ['bid_up', 'budget_increase'];

    if (spendingActions.includes(category)) {
      return {
        requiresConsent: true,
        consentLevel: 'basic',
        consentMessage: CONSENT_MESSAGES.basic(
          category === 'bid_up' ? 'Augmenter les enchères' : 'Augmenter le budget',
        ),
      };
    }

    return { requiresConsent: false, consentLevel: 'none' };
  }

  /**
   * Génère le label de stratégie pour une recommandation.
   */
  private generateLabel(
    score: number,
    category: ActionCategory,
    phase: LifecyclePhase,
    isRecommended: boolean,
  ): string {
    const phaseLabel = PHASE_LABELS[phase];

    if (isRecommended) {
      return `Recommandé en ${phaseLabel}`;
    }

    // Labels alternatifs basés sur pourquoi le score est bas
    if (score < 30) {
      if (phase === 'launch' && (category === 'pause' || category === 'add_negative')) {
        return 'Trop agressif en Lancement';
      }
      if (phase === 'evergreen' && category === 'bid_up') {
        return 'Risqué en Croisière';
      }
      return `Non recommandé en ${phaseLabel}`;
    }

    if (score < 50) {
      return `Option secondaire`;
    }

    if (score < 70) {
      // Competitive but not top
      const isAggressive = ['bid_up', 'budget_increase', 'harvest'].includes(category);
      return isAggressive ? 'Alternative agressive' : 'Alternative prudente';
    }

    return `Alternative viable en ${phaseLabel}`;
  }

  /**
   * Post-process recommendations with strategy scoring.
   * Groups by entityKey, scores each, and marks the best per entity.
   *
   * Now includes economic analysis: break-even ACoS, profit zones,
   * and hard guards against pausing profitable keywords.
   *
   * @param recos - Raw recommendations from the RulesEngine
   * @param lifecyclePhase - Current book lifecycle phase
   * @param strategyContext - Economic context (royaltyRate for break-even)
   * @param budgetGuard - Optional budget guard settings
   * @returns Enriched recommendations with strategy fields
   */
  process(
    recos: StrategyInput[],
    lifecyclePhase: LifecyclePhase,
    strategyContext?: StrategyContext,
    budgetGuard?: { maxSpend7d?: number; currentSpend7d?: number },
  ): StrategyResult[] {
    if (recos.length === 0) return [];

    // ── Economic context ──
    const breakEvenAcos = this.calculateBreakEvenAcos(strategyContext);

    // ── Step 1: Score each recommendation ──
    const scored: Array<StrategyInput & {
      score: number;
      category: ActionCategory;
      riskLevel: RiskLevel;
      consent: { requiresConsent: boolean; consentLevel: ConsentLevel; consentMessage?: string };
    }> = recos.map((reco) => {
      const category = this.categorizeAction(reco.actionType);
      const matrixEntry = SCORING_MATRIX[category]?.[lifecyclePhase] || { base: 50, riskPenalty: 0 };
      const metrics = reco.contextData?.metrics || {};
      const acos = Number(metrics.acos || 0);
      const orders = Number(metrics.orders || 0);

      // Base score from matrix
      let score = matrixEntry.base;

      // Apply risk penalty (lifecycle-based)
      if (matrixEntry.riskPenalty) {
        score += matrixEntry.riskPenalty;
      }

      // ── Economic analysis ──
      const profitAnalysis = this.classifyProfitZone(acos, breakEvenAcos, orders);

      // HARD GUARD : pénalité pause si mot-clé rentable
      score -= this.computePauseGuardPenalty(category, metrics, profitAnalysis);

      // Ajustements basés sur la zone de profit
      score += this.computeProfitZoneAdjustment(category, profitAnalysis, orders);

      // Context bonus (existant — métriques granulaires)
      score += this.computeContextBonus(category, metrics, lifecyclePhase);

      // Confidence score bonus (0-10 points)
      if (reco.confidenceScore != null) {
        const confBonus = (Number(reco.confidenceScore) / 100) * 10;
        score += confBonus;
      }

      // Clamp to 0-100
      score = Math.max(0, Math.min(100, Math.round(score)));

      // Risk level
      const riskLevel = this.determineRiskLevel(score, category, lifecyclePhase);

      // Consent
      let consent = this.determineConsent(category, lifecyclePhase, metrics);

      // Budget guard: upgrade to reinforced if budget exceeded
      if (
        budgetGuard?.maxSpend7d &&
        budgetGuard?.currentSpend7d &&
        budgetGuard.currentSpend7d >= budgetGuard.maxSpend7d &&
        lifecyclePhase === 'launch' &&
        ['bid_up', 'budget_increase'].includes(category)
      ) {
        consent = {
          requiresConsent: true,
          consentLevel: 'reinforced',
          consentMessage: CONSENT_MESSAGES.reinforced(
            `${budgetGuard.currentSpend7d.toFixed(0)}€`,
            `${budgetGuard.maxSpend7d.toFixed(0)}€`,
          ),
        };
      }

      return {
        ...reco,
        score,
        category,
        riskLevel,
        consent,
      };
    });

    // ── Step 2: Group by entityKey and mark best per entity ──
    const groups = new Map<string, typeof scored>();
    for (const item of scored) {
      const group = groups.get(item.entityKey) || [];
      group.push(item);
      groups.set(item.entityKey, group);
    }

    // Mark the highest-scored reco in each group as recommended
    const recommendedIds = new Set<string>();
    for (const [, group] of groups) {
      // Sort by score descending
      group.sort((a, b) => b.score - a.score);
      const best = group[0];
      if (best.score >= 70) {
        recommendedIds.add(best.id);
      }
    }

    // ── Step 3: Build results ──
    const results: StrategyResult[] = scored.map((item) => {
      const isRecommended = recommendedIds.has(item.id);

      return {
        id: item.id,
        strategyScore: item.score,
        strategyLabel: this.generateLabel(item.score, item.category, lifecyclePhase, isRecommended),
        riskLevel: item.riskLevel,
        recommendedForLifecycle: isRecommended,
        requiresConsent: item.consent.requiresConsent,
        consentLevel: item.consent.consentLevel,
        consentMessage: item.consent.consentMessage,
      };
    });

    this.logger.log(
      `[BREAK-EVEN V2] Strategy processed ${recos.length} recos for phase=${lifecyclePhase} ` +
      `(breakEvenACoS=${breakEvenAcos}%): ` +
      `${recommendedIds.size} recommended, ${recos.length - recommendedIds.size} alternatives`,
    );

    // Log détaillé par reco pour debug
    for (const item of scored) {
      const metrics = item.contextData?.metrics || {};
      this.logger.log(
        `  [RECO] ${item.actionType} | entity=${item.entityKey} | ` +
        `score=${item.score} | orders=${metrics.orders} | acos=${metrics.acos} | ` +
        `clicks=${metrics.clicks} | category=${item.category}`,
      );
    }

    return results;
  }
}
