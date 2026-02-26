/**
 * CampaignEvolutionEngine — Constantes et seuils
 */

// ── Seuils de détection ───────────────────────────────────────

/** Seuil de chaosScore au-dessus duquel on active le scénario B */
export const CHAOS_THRESHOLD = 0.6;

/** Seuil de duplicationScore au-dessus duquel on active le scénario B */
export const DUPLICATION_THRESHOLD = 0.5;

// ── Chaos Score Components ────────────────────────────────────

/** Nombre idéal de campagnes pour un livre mature */
export const IDEAL_CAMPAIGN_COUNT_MIN = 4;
export const IDEAL_CAMPAIGN_COUNT_MAX = 5;

/** Poids des composantes du chaos score */
export const CHAOS_WEIGHTS = {
  campaignCount: 0.25,
  adGroupDistribution: 0.25,
  budgetDistribution: 0.25,
  namingConsistency: 0.25,
};

// ── Maturity Score Weights ────────────────────────────────────

export const MATURITY_MAX = {
  structure: 30,
  winnersExploited: 30,
  diversification: 20,
  stability: 20,
};

// ── Diversification Scoring ───────────────────────────────────

export const DIVERSIFICATION_POINTS = {
  hasProductTargeting: 7,
  hasMultipleMatchTypes: 7,
  sbEligible: 6,
};

// ── SB/Video Eligibility Conditions ───────────────────────────

/** Nombre minimum de WINNER keywords pour proposer SB */
export const SB_MIN_WINNER_KEYWORDS = 3;

/** Les WINNERs doivent avoir un ACoS < breakEven × ce facteur */
export const SB_ACOS_FACTOR = 0.8;

/** Ventes mensuelles minimum (€) pour proposer SB */
export const SB_MIN_MONTHLY_SALES = 500;

/** Jours minimum de campagnes SP profitables pour proposer SB */
export const SB_MIN_PROFITABLE_DAYS = 30;

// ── Campaign Classification ───────────────────────────────────

/** Proportion de WINNERs pour classer une campagne en amplification */
export const AMPLIFICATION_WINNER_RATIO = 0.3;

// ── Lifecycle × Structure Matrix ──────────────────────────────

export const LIFECYCLE_CHAOS_THRESHOLDS: Record<string, number> = {
  launch: 0.7,
  scale: 0.6,
  evergreen: 0.5,
  relaunch: 0.6,
};

export const LIFECYCLE_EXPECTED_CAMPAIGNS: Record<string, { min: number; max: number }> = {
  launch: { min: 1, max: 2 },
  scale: { min: 3, max: 4 },
  evergreen: { min: 5, max: 6 },
  relaunch: { min: 2, max: 3 },
};

// ── Roadmap defaults ──────────────────────────────────────────

export const DEFAULT_AUTO_CAMPAIGN_BUDGET = 10.0;
export const DEFAULT_MANUAL_CAMPAIGN_BUDGET = 8.0;
export const DEFAULT_SB_CAMPAIGN_BUDGET = 12.0;
export const BID_INCREASE_PERCENT = 18;

// ── Garde-fous KDP : Paramètres par lifecycle ─────────────────

export const LIFECYCLE_DEFAULTS = {
  launch: {
    auto: { dailyBudget: 5, defaultBid: 0.45, biddingStrategy: 'LEGACY_FOR_SALES' },
    manual: { dailyBudget: 5, defaultBid: 0.40, biddingStrategy: 'LEGACY_FOR_SALES', defaultMatchTypes: ['exact'] as string[] },
    maxDailyBudget: 15,
  },
  scale: {
    auto: { dailyBudget: 10, defaultBid: 0.55, biddingStrategy: 'LEGACY_FOR_SALES' },
    manual: { dailyBudget: 8, defaultBid: 0.50, biddingStrategy: 'LEGACY_FOR_SALES', defaultMatchTypes: ['exact', 'phrase'] as string[] },
    maxDailyBudget: 30,
  },
  evergreen: {
    auto: { dailyBudget: 8, defaultBid: 0.50, biddingStrategy: 'LEGACY_FOR_SALES' },
    manual: { dailyBudget: 10, defaultBid: 0.55, biddingStrategy: 'LEGACY_FOR_SALES', defaultMatchTypes: ['exact'] as string[] },
    maxDailyBudget: 50,
  },
  relaunch: {
    auto: { dailyBudget: 8, defaultBid: 0.50, biddingStrategy: 'LEGACY_FOR_SALES' },
    manual: { dailyBudget: 6, defaultBid: 0.45, biddingStrategy: 'LEGACY_FOR_SALES', defaultMatchTypes: ['exact', 'phrase'] as string[] },
    maxDailyBudget: 25,
  },
} as const;

// ── Budget Guards (global) ───────────────────────────────────

export const BUDGET_GUARDS = {
  absoluteMin: 1,
  absoluteMax: 1000,
} as const;

// ── Bid Guards (global) ──────────────────────────────────────

export const BID_GUARDS = {
  absoluteMin: 0.10,
  absoluteMax: 5.00,
} as const;

// ── Gap Detection Thresholds ────────────────────────────────

/**
 * Severity of each gap type depends on lifecycle phase.
 * 'critical' = blocks growth, 'high' = significant, 'medium' = nice to have, 'low' = future
 */
export const GAP_SEVERITY_MATRIX: Record<string, Record<string, 'critical' | 'high' | 'medium' | 'low'>> = {
  GAP_EXPLORATION: { launch: 'critical', scale: 'high', evergreen: 'high', relaunch: 'critical' },
  GAP_VALIDATION:  { launch: 'high',     scale: 'critical', evergreen: 'critical', relaunch: 'high' },
  GAP_AMPLIFICATION: { launch: 'low',    scale: 'high', evergreen: 'high', relaunch: 'medium' },
  GAP_DIVERSIFICATION: { launch: 'low',  scale: 'medium', evergreen: 'high', relaunch: 'low' },
  GAP_VIDEO:       { launch: 'low',      scale: 'low', evergreen: 'medium', relaunch: 'low' },
  GAP_CLEANUP:     { launch: 'medium',   scale: 'high', evergreen: 'high', relaunch: 'high' },
};

/** Duplication threshold above which we detect GAP_CLEANUP */
export const GAP_CLEANUP_DUPLICATION_THRESHOLD = 0.4;

/** Chaos threshold above which we detect GAP_CLEANUP */
export const GAP_CLEANUP_CHAOS_THRESHOLD = 0.5;

// ── Harvest Config ─────────────────────────────────────────

/** Minimum winner keywords before accepting harvest (otherwise fallback to wider window) */
export const HARVEST_MIN_KEYWORDS = 3;

/** Harvest windows in days, tried in order until HARVEST_MIN_KEYWORDS met */
export const HARVEST_WINDOWS = [7, 14, 30, 60] as const;

/** Strategic period per lifecycle phase (base window for harvest) */
export const LIFECYCLE_STRATEGIC_DAYS: Record<string, number> = {
  launch: 7,
  scale: 14,
  evergreen: 30,
  relaunch: 14,
};

// ── Pause Batch Config ──────────────────────────────────────

export const PAUSE_BATCH_CONFIG = {
  maxPerBatch: 20,
  cooldownMs: 2000,
} as const;
