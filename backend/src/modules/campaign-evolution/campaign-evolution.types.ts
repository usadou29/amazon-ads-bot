/**
 * CampaignEvolutionEngine — Types & DTOs
 * Audit structurel, maturity score, roadmap 30 jours
 */

import { type LifecyclePhase } from '@/db/schema/books';
import { type MacroStrategyCode, type EntityDiagnosisCode, type EntityInsight, type CampaignMacroStrategy, type InsightMetrics } from '@/modules/insights';

// ── Re-exports pour usage interne ─────────────────────────────
export type { LifecyclePhase, MacroStrategyCode, EntityDiagnosisCode, EntityInsight, CampaignMacroStrategy, InsightMetrics };

// ── Campaign Roles ────────────────────────────────────────────

export type CampaignRole = 'exploration' | 'validation' | 'amplification' | 'diversification' | 'unknown';

export interface CampaignRoleAssignment {
  campaignId: string;
  campaignName: string;
  roles: CampaignRole[];
  macroStrategy: MacroStrategyCode;
  confidence: number; // 0-1
}

// ── Scenarios ─────────────────────────────────────────────────

export enum Scenario {
  A = 'scenario_a_no_campaigns',
  B = 'scenario_b_chaos_detected',
  C = 'scenario_c_winners_exist',
  STABLE = 'scenario_stable',
}

// ── Structural Issues ─────────────────────────────────────────

export type StructuralIssueType =
  | 'duplication'
  | 'chaos'
  | 'budget_fragmentation'
  | 'naming_inconsistency'
  | 'missing_role'
  | 'unexploited_winners';

export interface StructuralIssue {
  type: StructuralIssueType;
  severity: 'high' | 'medium' | 'low';
  description: string;
  affectedEntities: string[];
}

// ── Suggestions ───────────────────────────────────────────────

export type SuggestionType =
  | 'create_campaign'
  | 'pause_campaign'
  | 'consolidate_adgroup'
  | 'bid_increase'
  | 'negative_keyword'
  | 'rename_campaign'
  | 'restructure';

export interface StructuralSuggestion {
  priority: number; // 1-10, 10 = most important
  type: SuggestionType;
  description: string;
  estimatedImpact: string;
  details: Record<string, any>;
}

// ── Roadmap ───────────────────────────────────────────────────

export interface RoadmapAction {
  type: string;
  details: Record<string, any>;
  priority: 'high' | 'medium' | 'low';
  estimatedDurationHours?: number;
}

export interface RoadmapWeek {
  week: number; // 1-4
  actions: RoadmapAction[];
}

// ── Next Campaign Recommendations ─────────────────────────────

export interface NextCampaignRecommendation {
  campaignType: 'sponsoredProducts' | 'sponsoredBrands' | 'sponsoredDisplay';
  targetingType: 'manual' | 'auto';
  matchTypes?: ('exact' | 'phrase' | 'broad')[];
  keywords?: string[];
  estimatedDailyBudget: number;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
}

// ── Diversification Opportunities ─────────────────────────────

export interface DiversificationOpportunity {
  type: 'product_targeting' | 'video_campaign' | 'brand_campaign' | 'multi_match_type';
  description: string;
  prerequisites: string[];
  met: boolean;
  estimatedBudget?: number;
  priority: 'high' | 'medium' | 'low';
}

// ── Maturity Score ────────────────────────────────────────────

export interface MaturityBreakdown {
  structure: number;        // 0-30
  winnersExploited: number; // 0-30
  diversification: number;  // 0-20
  stability: number;        // 0-20
}

// ── Main Result ───────────────────────────────────────────────

export interface CampaignEvolutionResult {
  bookId: string;
  analyzedAt: string; // ISO 8601

  maturityScore: number; // 0-100
  maturityBreakdown: MaturityBreakdown;
  duplicationScore: number; // 0-1
  chaosScore: number;       // 0-1
  scenario: Scenario;

  campaignRoles: CampaignRoleAssignment[];
  structuralIssues: StructuralIssue[];
  suggestions: StructuralSuggestion[];
  roadmap: RoadmapWeek[];
  nextCampaignRecommendations: NextCampaignRecommendation[];
  diversificationOpportunities: DiversificationOpportunity[];

  context: EvolutionContext;
}

export interface EvolutionContext {
  lifecyclePhase: string;
  totalCampaigns: number;
  totalAdGroups: number;
  totalKeywords: number;
  totalProductTargets: number;
  totalWinnerKeywords: number;
  totalBoostCandidateKeywords: number;
}

// ── Internal types for data passing ───────────────────────────

export interface CampaignGraph {
  campaigns: CampaignWithEntities[];
}

export interface CampaignWithEntities {
  id: string;
  name: string;
  campaignType: string;
  targetingType: string | null;
  state: string;
  dailyBudget: number | null;
  startDate: string | null;
  adGroups: AdGroupWithEntities[];
}

export interface AdGroupWithEntities {
  id: string;
  name: string;
  state: string;
  defaultBid: number | null;
  keywords: KeywordEntity[];
  targets: TargetEntity[];
}

export interface KeywordEntity {
  id: string;
  amazonKeywordId: number;
  keywordText: string;
  matchType: string;
  state: string;
  bid: number | null;
}

export interface TargetEntity {
  id: string;
  amazonTargetId: number;
  expressionType: string;
  expression: any;
  state: string;
  bid: number | null;
}

export interface BookContext {
  id: string;
  title: string | null;
  asin: string;
  lifecyclePhase: string;
  acosTarget: number;
  royaltyPerUnit: number | null;
  salePrice: number | null;
}

export interface ScenarioContext {
  bookContext: BookContext;
  campaigns: CampaignWithEntities[];
  entityInsightsMap: Map<string, EntityInsight[]>; // campaignId -> EntityInsight[]
  macroStrategies: Map<string, CampaignMacroStrategy>; // campaignId -> CampaignMacroStrategy
  duplicationScore: number;
  chaosScore: number;
  campaignRoles: CampaignRoleAssignment[];
}

export interface RoadmapContext {
  scenario: Scenario;
  bookContext: BookContext;
  suggestions: StructuralSuggestion[];
  campaigns: CampaignWithEntities[];
  campaignRoles: CampaignRoleAssignment[];
}
