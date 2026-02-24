import type { LifecyclePhase } from '@/db/schema/books';

// ── Campaign Diagnosis Codes ────────────────────────────────
export enum CampaignDiagnosisCode {
  INVISIBLE = 'invisible',
  LOW_SIGNAL = 'low_signal',           // impressions > 0 mais < MIN_IMPRESSIONS_FOR_SIGNAL
  IGNORED = 'ignored',
  TOO_EARLY = 'too_early',
  ATTRACTIVE_NOT_CONVERTING = 'attractive_not_converting',
  PROMISING_BUT_EXPENSIVE = 'promising_but_expensive',
  PROFITABLE = 'profitable',
  LIMITED_BY_BUDGET = 'limited_by_budget',
}

// ── Entity Diagnosis Codes ──────────────────────────────────
// Chaque entité reçoit TOUJOURS un diagnostic humain lisible.
// L'eligibility (assez de data pour une action exécutable) est séparée.
export enum EntityDiagnosisCode {
  NO_IMPRESSIONS = 'no_impressions',     // impressions === 0
  ZERO_CLICKS_LOW_VOLUME = 'zero_clicks_low_volume', // impressions > 0 && < 300, clicks === 0 → pas assez de volume pour juger
  ZERO_CLICKS = 'zero_clicks',           // impressions >= 300, clicks === 0 → vraiment ignoré
  VERY_LOW_CLICKS = 'very_low_clicks',   // 1-4 clicks
  LOW_CLICKS = 'low_clicks',             // 5-14 clicks
  CLICKS_NO_SALES = 'clicks_no_sales',   // clicks >= 15, orders === 0
  VERY_EXPENSIVE = 'very_expensive',     // orders > 0 mais ACoS > breakEven × 1.3 → saigne du budget
  EXPENSIVE_BUT_VALID = 'expensive_but_valid',
  WINNER = 'winner',
  BOOST_CANDIDATE = 'boost_candidate',
  COOLDOWN_ACTIVE = 'cooldown_active',  // Enchère modifiée récemment, en période d'observation
}

// ── Trend Direction ─────────────────────────────────────────
export enum TrendDirection {
  UP = 'up',         // ACoS baisse ET/OU conversion monte
  STABLE = 'stable', // Pas de changement significatif
  DOWN = 'down',     // ACoS monte OU conversion baisse
}

// ── Action Execution Types ──────────────────────────────────
export type ActionExecution = 'ads' | 'book' | 'none';

export interface InsightAction {
  type: string;
  execution: ActionExecution;
  i18nKey: string;
  priority: number;
}

// ── Summary Facts ───────────────────────────────────────────
export interface SummaryFacts {
  impressions: number;
  clicks: number;
  ctr: number | null;
  orders: number;
  cvr: number | null;
  spend: number;
  sales: number;
  acos: number | null;
  periodDays: number;
}

// ── Campaign Insight ────────────────────────────────────────
export interface TrendAnalysis {
  strategicAcos: number | null;
  trendAcos: number | null;
  strategicCvr: number | null;
  trendCvr: number | null;
}

export type CampaignTargetingType = 'keyword' | 'product' | 'auto';

export interface CampaignInsight {
  campaignId: string;
  diagnosisCode: CampaignDiagnosisCode;
  summaryFacts: SummaryFacts;
  macroStrategy: CampaignMacroStrategy;
  confidenceScore: number;
  strategicPeriodDays: number;
  trendDirection: TrendDirection;
  trendAnalysis?: TrendAnalysis;
  targetingType: CampaignTargetingType;
}

// ── Entity Insight ──────────────────────────────────────────
export interface EntityInsight {
  entityKey: string;
  entityType: 'keyword' | 'target' | 'search_term' | 'ad_group';
  diagnosisCode: EntityDiagnosisCode;
  eligibility: boolean; // true = assez de data pour recommander une action exécutable (clicks >= 15)
  summaryFacts: SummaryFacts;
  suggestedActions: InsightAction[];
  linkedRecommendation?: {
    id: string;
    actionType: string;
    strategyScore: number;
    strategyLabel: string;
  };
  confidenceScore: number;
  // Multi-window v2 fields
  decisionPeriodDays?: number;         // Fenêtre de décision choisie dynamiquement
  validationApplied?: boolean;          // Si la validation 30j a ajusté l'action
  validationExplanation?: string;       // Raison de l'ajustement
  // Lifecycle guardrail v2.1
  guardrailApplied?: boolean;           // Si le guardrail lifecycle a downgradé l'action
  guardrailExplanation?: string;        // Message explicatif pour l'UI
  // Window divergence v2.2
  longWindowFacts?: {                   // Métriques 30j pour transparence quand les fenêtres divergent
    orders: number;
    clicks: number;
    sales: number;
    acos: number | null;
    periodDays: 30;
  };
}

// ── Macro Strategy (campaign-level, derived from entity insights) ─
export enum MacroStrategyCode {
  SCALE_WINNERS = 'scale_winners',
  CONTINUE_TESTING = 'continue_testing',
  FIX_LISTING = 'fix_listing',
  CUT_LOSERS = 'cut_losers',
  NO_SIGNAL_YET = 'no_signal_yet',
}

export interface CampaignMacroStrategy {
  macroStrategyCode: MacroStrategyCode;
  winnersCount: number;
  boostCandidatesCount: number;
  testingCount: number;        // VERY_LOW_CLICKS + LOW_CLICKS
  ignoredCount: number;        // NO_IMPRESSIONS + ZERO_CLICKS
  losersCount: number;         // CLICKS_NO_SALES
  expensiveCount: number;      // EXPENSIVE_BUT_VALID
  totalEntities: number;
  eligibleCount: number;       // entities with clicks >= 15
}

// ── Multi-Window Metrics ─────────────────────────────────────
export interface WindowMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
  acos?: number | null;
  ctr?: number | null;
  cvr?: number | null;
}

export interface MetricsByWindow {
  window_7d: WindowMetrics;
  window_14d: WindowMetrics;
  window_30d: WindowMetrics;
}

// ── Metrics Input (compatible with existing CalculatedKPIs) ─
export interface InsightMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units?: number;
  acos?: number | null;
  ctr?: number | null;
  cvr?: number | null;
  cpc?: number | null;
}

// ── Campaign Input ──────────────────────────────────────────
export interface InsightCampaignInput {
  id: string;
  name: string;
  dailyBudget?: number | null;
}

// ── Entity Input ────────────────────────────────────────────
export interface InsightEntityInput {
  key: string;
  type: 'keyword' | 'target' | 'search_term' | 'ad_group';
  name: string;
  campaignId?: string;
  campaignName?: string;
}
