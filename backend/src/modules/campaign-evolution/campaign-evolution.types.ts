/**
 * CampaignEvolutionEngine — Types & DTOs
 * Audit structurel, maturity score, roadmap 30 jours, TopFocus, CreationPlan
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

// ── Gap Detection ────────────────────────────────────────────

export enum GapType {
  GAP_EXPLORATION = 'GAP_EXPLORATION',       // Missing Auto campaign
  GAP_VALIDATION = 'GAP_VALIDATION',         // Missing Exact/Phrase campaign
  GAP_AMPLIFICATION = 'GAP_AMPLIFICATION',   // Winners not isolated in dedicated Exact
  GAP_DIVERSIFICATION = 'GAP_DIVERSIFICATION', // No product targeting
  GAP_VIDEO = 'GAP_VIDEO',                   // Eligible for SB Video but none exists
  GAP_CLEANUP = 'GAP_CLEANUP',               // High duplication/chaos requiring cleanup
}

export type GapSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface StructuralGap {
  type: GapType;
  severity: GapSeverity;
  label: string;
  explanation: string;
  campaignsToCreate: CampaignPlanType[];
}

// ── Pause Strategy (for rebuild flows) ──────────────────────

export interface CampaignToPause {
  campaignId: string;
  name: string;
  reason: string;
  harvestedKeywords?: string[];
  harvestedAsins?: string[];
}

export interface PauseStrategy {
  campaignsToPause: CampaignToPause[];
  totalBudgetToSave: number;
}

// ── Harvested Assets (from HarvestService) ──────────────────

export interface WinnerKeywordAsset {
  text: string;
  matchType: string;
  acos?: number;
  orders?: number;
  campaignId: string;
}

export interface SearchTermAsset {
  query: string;
  count: number;
}

export interface HarvestedAssets {
  winnerKeywords: WinnerKeywordAsset[];
  winnerSearchTerms: SearchTermAsset[];
  winnerAsins: string[];
  suggestedNegatives: string[];
  windowDays: number;
  /** Average CPC of winner keywords (real data) */
  avgWinningBid: number | null;
  /** Average CPC across all keywords with spend (real data) */
  avgCpcObserved: number | null;
  /** Top-of-search performance ratio (CVR top / CVR other). >1 = top is better */
  topPlacementPerformance: number | null;
  /** User-provided keywords (from book title or manual input) */
  userProvidedKeywords: string[];
}

// ── Lifecycle Detection ─────────────────────────────────────

export interface LifecycleDetection {
  phase: string;
  confidence: number;  // 0-1
  reasonBullets: string[];
}

// ── Pause All For Book ──────────────────────────────────────

export interface PauseAllForBookDto {
  workspaceId: string;
  bookId: string;
  reason?: string;
}

export interface PauseAllForBookResult {
  totalActive: number;
  totalPaused: number;
  totalFailed: number;
  totalAlreadyPaused: number;
  totalBudgetSaved: number;
  failedCampaigns: Array<{ campaignId: string; name: string; error: string }>;
}

// ── Creation Plan Request (on-demand) ───────────────────────

export interface CreationPlanRequestDto {
  bookId: string;
  workspaceId: string;
  lifecyclePhaseOverride?: string;
  forceRebuild?: boolean;
  /** User-chosen creation mode: HARVEST (optimize existing) or RESET (start fresh) */
  mode?: CreationMode;
}

export interface CreationPlanResponse {
  creationPlan: CreationPlan;
  roadmap: RoadmapWeek[];
  gaps: StructuralGap[];
  harvestedAssets: HarvestedAssets;
  lifecycleUsed: string;
  /** Which creation mode was used */
  modeUsed: CreationMode;
}

// ── Creation Mode (user-selected strategy) ───────────────────
/** HARVEST = optimize from existing data, RESET = start fresh */
export type CreationMode = 'HARVEST' | 'RESET';

// ── Scenarios ─────────────────────────────────────────────────

export enum Scenario {
  A = 'scenario_a_no_campaigns',
  B = 'scenario_b_chaos_detected',
  C = 'scenario_c_winners_exist',
  STABLE = 'scenario_stable',
}

// ── Top Focus ─────────────────────────────────────────────────

export type TopFocusTheme = 'VISIBILITE' | 'CONVERSION' | 'RENTABILITE' | 'STRUCTURE';
export type CtaIntent = 'CREATE' | 'CLEANUP' | 'AMPLIFY' | 'OBSERVE';

export interface TopFocusEvidence {
  label: string;
  value: string;
}

export interface TopFocusCta {
  label: string;
  intent: CtaIntent;
  planId?: string; // if intent=CREATE, references creationPlan.planId
}

export interface TopFocus {
  theme: TopFocusTheme;
  title: string;
  summary: string;
  evidence: TopFocusEvidence[]; // max 2
  primaryCta: TopFocusCta;
}

// ── Creation Plan ─────────────────────────────────────────────

export type CampaignPlanType =
  | 'SP_AUTO'
  | 'SP_MANUAL_BROAD'
  | 'SP_MANUAL_PHRASE'
  | 'SP_MANUAL_EXACT'
  | 'SP_PRODUCT'
  | 'SP_CATEGORY'
  | 'SB_VIDEO';

export type BiddingStrategy = 'DOWN_ONLY' | 'UP_DOWN' | 'FIXED';

export interface PlacementAdjustments {
  topOfSearch: number;
  restOfSearch: number;
  productPages: number;
}

/** Explanation block for each campaign parameter — displayed in wizard "Pourquoi ce choix?" */
export interface CampaignExplanation {
  parameter: string;    // e.g. 'type', 'bid', 'budget', 'biddingStrategy', 'placementAdjustments', 'keywords', 'negatives'
  value: string;        // human-readable value
  reasoning: string;    // "Pourquoi ce choix?" in author-friendly French
  dataSource: string;   // e.g. 'real_data', 'lifecycle_default', 'inferred', 'rule_based'
}

export interface CampaignToCreate {
  name: string;
  type: CampaignPlanType;
  targetingMode: 'AUTO' | 'MANUAL';
  dailyBudget: number;
  defaultBid: number;
  biddingStrategy: BiddingStrategy;
  placementAdjustments?: PlacementAdjustments;
  seedKeywords?: string[];
  seedAsins?: string[];
  negativeKeywords?: string[];
  notesWhy: string; // 1 phrase auteur-friendly
  explanations: CampaignExplanation[];
}

export interface CreationPlan {
  planId: string;
  fingerprint: string;
  campaignsToCreate: CampaignToCreate[];
  gaps: GapType[];
  pauseStrategy?: PauseStrategy;
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
  why: string;
  impact: string;
}

export interface RoadmapWeek {
  week: number; // 1-4
  title: string;
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

  // ── New: Top Focus ──
  topFocus: TopFocus;
  creationPlan?: CreationPlan;
  gaps: StructuralGap[];
  lifecycleDetected: LifecycleDetection;

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
  avgAcos?: number;
  totalSpend30d?: number;
  totalSales30d?: number;
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
  entityInsightsMap?: Map<string, EntityInsight[]>;
  gaps?: StructuralGap[];
}

// ── Pause Batch DTO ─────────────────────────────────────────

export interface PauseBatchDto {
  workspaceId: string;
  bookId: string;
  campaignIds: string[];
  reason: string;
}

export interface PauseBatchResult {
  totalRequested: number;
  totalPaused: number;
  totalFailed: number;
  results: Array<{
    campaignId: string;
    campaignName: string;
    success: boolean;
    message: string;
  }>;
}

// ── TopFocus Context (for TopFocusService) ────────────────────

export interface TopFocusContext {
  scenario: Scenario;
  bookContext: BookContext;
  campaigns: CampaignWithEntities[];
  entityInsightsMap: Map<string, EntityInsight[]>;
  duplicationScore: number;
  chaosScore: number;
  campaignRoles: CampaignRoleAssignment[];
  maturityScore: number;
  context: EvolutionContext;
  gaps: StructuralGap[];
}
