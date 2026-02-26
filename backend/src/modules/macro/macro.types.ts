import type { LifecyclePhase } from '@/db/schema/books';

// ── Action Types ──────────────────────────────────────

export type MacroSuggestionActionType =
  | 'set_bidding_strategy'
  | 'update_placements'
  | 'increase_budget'
  | 'decrease_budget'
  | 'none';

export type MacroImpactTag =
  | 'stabiliser'
  | 'accélérer'
  | 'réduire dépenses'
  | 'protéger rentabilité';

export type MacroRiskLevel = 'low' | 'medium' | 'high';

export type BiddingStrategy = 'fixed' | 'down_only' | 'up_and_down';

// ── Placement Structure ───────────────────────────────

export interface PlacementAdjustments {
  topOfSearch: number;       // percentage multiplier (0-900)
  restOfSearch: number;      // percentage multiplier (0-900)
  productPages: number;      // percentage multiplier (0-900)
}

// ── Main DTO ──────────────────────────────────────────

export interface MacroSuggestionDTO {
  id: string;
  campaignId: string;
  title: string;
  why: string;
  bullets: string[];
  impactTag: MacroImpactTag;
  riskLevel: MacroRiskLevel;
  actionType: MacroSuggestionActionType;
  executable: boolean;

  current: {
    biddingStrategy?: BiddingStrategy;
    placements?: PlacementAdjustments;
    budget?: number;
  };

  recommended?: {
    biddingStrategy?: BiddingStrategy;
    placements?: PlacementAdjustments;
    budget?: number;
  };

  guardrails?: {
    requiresConsent: boolean;
    consentLevel: 'none' | 'basic' | 'reinforced';
    cooldownDays?: number;
  };

  evidence: MacroEvidence;
}

export interface MacroEvidence {
  strategicPeriodDays: number;
  trendPeriodDays?: number;
  acosStrategic?: number;
  acosTrend?: number;
  cvrStrategic?: number;
  cvrTrend?: number;
  spendShareImpacted?: number;
  budgetUtilization?: number;
  diagnosticsDistribution?: Record<string, number>;
}

// ── Request/Response ──────────────────────────────────

export interface MacroSuggestionRequest {
  bookId: string;
  lifecyclePhase: LifecyclePhase;
}

export interface MacroExecuteRequest {
  workspaceId: string;
  campaignId: string;
  suggestionId: string;
  actionType: MacroSuggestionActionType;
  recommended: {
    biddingStrategy?: BiddingStrategy;
    placements?: PlacementAdjustments;
    budget?: number;
  };
}

export interface MacroExecuteResult {
  success: boolean;
  actionType: MacroSuggestionActionType;
  applied: Record<string, any>;
  error?: string;
}
