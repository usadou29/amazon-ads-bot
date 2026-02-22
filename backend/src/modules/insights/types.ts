import type { LifecyclePhase } from '@/db/schema/books';

// ── Campaign Diagnosis Codes ────────────────────────────────
export enum CampaignDiagnosisCode {
  INVISIBLE = 'invisible',
  IGNORED = 'ignored',
  TOO_EARLY = 'too_early',
  ATTRACTIVE_NOT_CONVERTING = 'attractive_not_converting',
  PROMISING_BUT_EXPENSIVE = 'promising_but_expensive',
  PROFITABLE = 'profitable',
  LIMITED_BY_BUDGET = 'limited_by_budget',
}

// ── Entity Diagnosis Codes ──────────────────────────────────
export enum EntityDiagnosisCode {
  NO_IMPRESSIONS = 'no_impressions',
  LOW_CTR = 'low_ctr',
  TOO_EARLY = 'too_early',
  CLICKS_NO_SALES = 'clicks_no_sales',
  EXPENSIVE_BUT_VALID = 'expensive_but_valid',
  WINNER = 'winner',
  BOOST_CANDIDATE = 'boost_candidate',
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
export interface CampaignInsight {
  campaignId: string;
  diagnosisCode: CampaignDiagnosisCode;
  summaryFacts: SummaryFacts;
  suggestedActions: InsightAction[];
  confidenceScore: number;
}

// ── Entity Insight ──────────────────────────────────────────
export interface EntityInsight {
  entityKey: string;
  entityType: 'keyword' | 'target' | 'search_term' | 'ad_group';
  diagnosisCode: EntityDiagnosisCode;
  summaryFacts: SummaryFacts;
  suggestedActions: InsightAction[];
  linkedRecommendation?: {
    id: string;
    actionType: string;
    strategyScore: number;
    strategyLabel: string;
  };
  confidenceScore: number;
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
