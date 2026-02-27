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

// ── Strategic Builder: Default Bids per Lifecycle ───────────
// Used as fallback when no historical data (avgWinningBid) is available

export const LIFECYCLE_DEFAULT_BIDS: Record<string, number> = {
  launch: 0.45,
  scale: 0.55,
  evergreen: 0.50,
  relaunch: 0.50,
};

// ── Strategic Builder: Bid Strategy per Lifecycle ───────────

export type StrategicBiddingStrategy = 'DOWN_ONLY' | 'UP_DOWN' | 'FIXED';

export const LIFECYCLE_BID_STRATEGY: Record<string, Record<string, StrategicBiddingStrategy>> = {
  launch: {
    SP_AUTO: 'UP_DOWN',
    SP_MANUAL_BROAD: 'UP_DOWN',
    SP_MANUAL_PHRASE: 'UP_DOWN',
    SP_MANUAL_EXACT: 'UP_DOWN',
    SP_PRODUCT: 'DOWN_ONLY',
    SP_CATEGORY: 'DOWN_ONLY',
    default: 'UP_DOWN',
  },
  scale: {
    SP_AUTO: 'DOWN_ONLY',
    SP_MANUAL_BROAD: 'DOWN_ONLY',
    SP_MANUAL_PHRASE: 'DOWN_ONLY',
    SP_MANUAL_EXACT: 'UP_DOWN', // Winners Exact gets UP_DOWN
    SP_PRODUCT: 'DOWN_ONLY',
    SP_CATEGORY: 'DOWN_ONLY',
    default: 'DOWN_ONLY',
  },
  evergreen: {
    SP_AUTO: 'DOWN_ONLY',
    SP_MANUAL_BROAD: 'DOWN_ONLY',
    SP_MANUAL_PHRASE: 'DOWN_ONLY',
    SP_MANUAL_EXACT: 'UP_DOWN', // Winners Exact gets UP_DOWN
    SP_PRODUCT: 'DOWN_ONLY',
    SP_CATEGORY: 'DOWN_ONLY',
    default: 'DOWN_ONLY',
  },
  relaunch: {
    SP_AUTO: 'UP_DOWN',
    SP_MANUAL_BROAD: 'UP_DOWN',
    SP_MANUAL_PHRASE: 'DOWN_ONLY',
    SP_MANUAL_EXACT: 'UP_DOWN',
    SP_PRODUCT: 'DOWN_ONLY',
    SP_CATEGORY: 'DOWN_ONLY',
    default: 'UP_DOWN',
  },
};

// ── Strategic Builder: Budget per Lifecycle + Campaign Type ──

export const STRATEGIC_BUDGETS: Record<string, Record<string, number>> = {
  launch: {
    SP_AUTO: 10,
    SP_MANUAL_BROAD: 8,
    SP_MANUAL_PHRASE: 8,
    SP_MANUAL_EXACT: 10,
    SP_PRODUCT: 5,
    SP_CATEGORY: 5,
    SB_VIDEO: 10,
    default: 8,
  },
  scale: {
    SP_AUTO: 12,
    SP_MANUAL_BROAD: 10,
    SP_MANUAL_PHRASE: 10,
    SP_MANUAL_EXACT: 20, // Winners Exact gets high budget
    SP_PRODUCT: 10,
    SP_CATEGORY: 8,
    SB_VIDEO: 15,
    default: 10,
  },
  evergreen: {
    SP_AUTO: 10,
    SP_MANUAL_BROAD: 8,
    SP_MANUAL_PHRASE: 8,
    SP_MANUAL_EXACT: 15,
    SP_PRODUCT: 10,
    SP_CATEGORY: 10,
    SB_VIDEO: 12,
    default: 10,
  },
  relaunch: {
    SP_AUTO: 10,
    SP_MANUAL_BROAD: 8,
    SP_MANUAL_PHRASE: 8,
    SP_MANUAL_EXACT: 12,
    SP_PRODUCT: 8,
    SP_CATEGORY: 5,
    SB_VIDEO: 10,
    default: 8,
  },
};

// ── Strategic Builder: Placement Adjustments ────────────────

/** TopOfSearch placement boost when CVR top > others (topPlacementPerformance > 1.0) */
export const PLACEMENT_TOP_OF_SEARCH_BOOST_MIN = 20; // %
export const PLACEMENT_TOP_OF_SEARCH_BOOST_MAX = 40; // %
/** Threshold above which top-of-search placement boost is applied */
export const PLACEMENT_PERFORMANCE_THRESHOLD = 1.0;

// ── Strategic Builder: Winner Bid Multiplier ────────────────

/** Multiply avgWinningBid by this factor for new campaign bids */
export const WINNER_BID_MULTIPLIER = 1.05;
