/**
 * Action Selection Engine — Endromède SaaS
 *
 * Sélectionne l'action par défaut à afficher dans la colonne "Action"
 * à partir du diagnostic, de la liste d'actions, et du contexte.
 *
 * Règles de priorité :
 * A) ACTION_PUB éligible => score = confidence + categoryWeight + urgencyBonus
 * B) OBSERVATION => watch si clicks ≥ 5, sinon wait
 * C) BOOK_ADVICE en fallback
 */

// ── Types ──────────────────────────────────────────────────────

export type ActionCategory = 'ACTION_PUB' | 'BOOK_ADVICE' | 'OBSERVATION';

export type ActionType =
  | 'bid_up'
  | 'bid_down'
  | 'pause'
  | 'add_negative'
  | 'harvest_exact'
  | 'harvest'
  | 'improve_listing'
  | 'improve_cover'
  | 'wait'
  | 'watch'
  | 'monitor'
  | 'patience';

export interface ActionSuggestionItem {
  id: string;
  label: string;
  category: ActionCategory;
  actionType: ActionType;
  executable: boolean;
  eligible: boolean;
  confidence: number; // 0..100
  priorityHint?: 'primary' | 'secondary';
  reasons?: string[];
  payload?: Record<string, unknown>;
}

// ── Constants ──────────────────────────────────────────────────

const CATEGORY_WEIGHT: Record<ActionCategory, number> = {
  ACTION_PUB: 100,
  OBSERVATION: 30,
  BOOK_ADVICE: 10,
};

/** Map action type → category */
export const ACTION_TYPE_TO_CATEGORY: Record<ActionType, ActionCategory> = {
  bid_up: 'ACTION_PUB',
  bid_down: 'ACTION_PUB',
  pause: 'ACTION_PUB',
  add_negative: 'ACTION_PUB',
  harvest_exact: 'ACTION_PUB',
  harvest: 'ACTION_PUB',
  improve_listing: 'BOOK_ADVICE',
  improve_cover: 'BOOK_ADVICE',
  wait: 'OBSERVATION',
  watch: 'OBSERVATION',
  monitor: 'OBSERVATION',
  patience: 'OBSERVATION',
};

/** Map execution type ('ads'|'book'|'none') → category */
export function executionToCategory(execution: string): ActionCategory {
  switch (execution) {
    case 'ads': return 'ACTION_PUB';
    case 'book': return 'BOOK_ADVICE';
    default: return 'OBSERVATION';
  }
}

/** Diagnosis codes that get urgency bonus for specific action types */
const URGENCY_MAP: Record<string, ActionType[]> = {
  clicks_no_sales: ['pause', 'add_negative', 'bid_down'],
  expensive_but_valid: ['bid_down'],
  winner: ['bid_up'],
  boost_candidate: ['bid_up'],
  no_impressions: ['bid_up'],
};

const CLICKS_THRESHOLD_WATCH = 5;    // ≥ 5 clicks → watch au lieu de wait
const CLICKS_THRESHOLD_DECISION = 15; // seuil de décision standard

// ── Scoring ────────────────────────────────────────────────────

function scoreAction(
  action: ActionSuggestionItem,
  diagnosisCode: string,
): number {
  let score = 0;

  // Base: category weight
  score += CATEGORY_WEIGHT[action.category];

  // Confidence contribution (0..100 scaled to 0..50)
  score += (action.confidence / 100) * 50;

  // Urgency bonus
  const urgentTypes = URGENCY_MAP[diagnosisCode];
  if (urgentTypes?.includes(action.actionType)) {
    score += 20;
  }

  // Primary hint bonus
  if (action.priorityHint === 'primary') {
    score += 15;
  }

  // Eligible bonus (significant)
  if (action.eligible) {
    score += 30;
  }

  return score;
}

// ── Main Selection Function ────────────────────────────────────

export interface SelectionContext {
  diagnosisCode: string;
  clicks: number;
  lifecyclePhase?: string;
}

/**
 * Sélectionne l'action par défaut pour la colonne "Action".
 *
 * Priorité :
 * A) ACTION_PUB éligible → par score
 * B) OBSERVATION → watch si clicks ≥ 5, sinon wait/patience
 * C) BOOK_ADVICE en fallback
 * D) Première action disponible (catch-all)
 */
export function selectDefaultAction(
  actions: ActionSuggestionItem[],
  context: SelectionContext,
): ActionSuggestionItem | null {
  if (!actions || actions.length === 0) return null;

  // ── A) ACTION_PUB éligibles ──
  const eligiblePubActions = actions.filter(
    a => a.category === 'ACTION_PUB' && a.eligible,
  );

  if (eligiblePubActions.length > 0) {
    // Score-based selection
    const scored = eligiblePubActions.map(a => ({
      action: a,
      score: scoreAction(a, context.diagnosisCode),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].action;
  }

  // ── B) OBSERVATION ──
  const observations = actions.filter(a => a.category === 'OBSERVATION');
  if (observations.length > 0) {
    if (context.clicks >= CLICKS_THRESHOLD_WATCH && context.clicks < CLICKS_THRESHOLD_DECISION) {
      // Prefer 'watch'/'monitor' over 'wait'/'patience'
      const watchAction = observations.find(a => a.actionType === 'watch' || a.actionType === 'monitor');
      if (watchAction) return watchAction;
    }
    // Default to 'wait'/'patience'
    const waitAction = observations.find(a => a.actionType === 'wait' || a.actionType === 'patience');
    if (waitAction) return waitAction;
    return observations[0];
  }

  // ── C) BOOK_ADVICE fallback ──
  const bookAdvice = actions.filter(a => a.category === 'BOOK_ADVICE');
  if (bookAdvice.length > 0) {
    return bookAdvice[0];
  }

  // ── D) Catch-all ──
  return actions[0];
}

// ── Conversion helpers ─────────────────────────────────────────

/**
 * Convertit un InsightAction legacy en ActionSuggestionItem.
 * Permet la compatibilité avec le système existant.
 */
export function insightActionToSuggestionItem(
  action: { type: string; execution: string; label: string; priority?: number },
  insight: { diagnosisCode: string; eligibility: boolean; confidenceScore: number },
  index: number,
): ActionSuggestionItem {
  const actionType = action.type as ActionType;
  const category = ACTION_TYPE_TO_CATEGORY[actionType] || executionToCategory(action.execution);

  return {
    id: `${insight.diagnosisCode}_${action.type}_${index}`,
    label: action.label,
    category,
    actionType,
    executable: action.execution === 'ads',
    eligible: action.execution === 'ads' ? insight.eligibility : true,
    confidence: insight.confidenceScore,
    priorityHint: index === 0 ? 'primary' : 'secondary',
    reasons: [],
  };
}
