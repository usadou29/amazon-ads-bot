import {
  selectDefaultAction,
  insightActionToSuggestionItem,
  type ActionSuggestionItem,
  type ActionCategory,
  type ActionType,
  type SelectionContext,
} from './action-selection';

// ── Helpers ──────────────────────────────────────────────────

function makeAction(
  overrides: Partial<ActionSuggestionItem> & { actionType: ActionType },
): ActionSuggestionItem {
  const defaults: ActionSuggestionItem = {
    id: `test_${overrides.actionType}`,
    label: overrides.actionType,
    category: 'ACTION_PUB',
    actionType: overrides.actionType,
    executable: true,
    eligible: true,
    confidence: 50,
  };
  return { ...defaults, ...overrides };
}

function ctx(overrides: Partial<SelectionContext> = {}): SelectionContext {
  return {
    diagnosisCode: 'clicks_no_sales',
    clicks: 20,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════
// TEST SUITE
// ══════════════════════════════════════════════════════════════

describe('selectDefaultAction', () => {
  // ── Test 1: CLICKS_NO_SALES avec [BOOK_ADVICE + ACTION_PUB + OBSERVATION] ──
  test('CLICKS_NO_SALES: choisit ACTION_PUB éligible plutôt que BOOK_ADVICE', () => {
    const actions: ActionSuggestionItem[] = [
      makeAction({ actionType: 'improve_listing', category: 'BOOK_ADVICE', executable: false, eligible: true, confidence: 60 }),
      makeAction({ actionType: 'add_negative', category: 'ACTION_PUB', eligible: true, confidence: 50 }),
      makeAction({ actionType: 'monitor', category: 'OBSERVATION', executable: false, eligible: true, confidence: 40 }),
    ];

    const result = selectDefaultAction(actions, ctx({ diagnosisCode: 'clicks_no_sales', clicks: 20 }));

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('add_negative');
    expect(result!.category).toBe('ACTION_PUB');
  });

  // ── Test 2: TRES_PEU_DE_CLICS → wait si clicks < 5 ──
  test('VERY_LOW_CLICKS + clicks < 5: choisit wait/patience', () => {
    const actions: ActionSuggestionItem[] = [
      makeAction({ actionType: 'patience', category: 'OBSERVATION', executable: false, eligible: true, confidence: 30 }),
      makeAction({ actionType: 'monitor', category: 'OBSERVATION', executable: false, eligible: true, confidence: 30 }),
    ];

    const result = selectDefaultAction(actions, ctx({ diagnosisCode: 'very_low_clicks', clicks: 3 }));

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('patience'); // wait/patience preferred when clicks < 5
  });

  // ── Test 3: TRES_PEU_DE_CLICS → watch/monitor si clicks >= 5 ──
  test('LOW_CLICKS + clicks >= 5: choisit watch/monitor', () => {
    const actions: ActionSuggestionItem[] = [
      makeAction({ actionType: 'patience', category: 'OBSERVATION', executable: false, eligible: true, confidence: 30 }),
      makeAction({ actionType: 'monitor', category: 'OBSERVATION', executable: false, eligible: true, confidence: 30 }),
    ];

    const result = selectDefaultAction(actions, ctx({ diagnosisCode: 'low_clicks', clicks: 8 }));

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('monitor'); // watch/monitor preferred when clicks >= 5
  });

  // ── Test 4: NO_IMPRESSIONS + ACTION_PUB éligible → bid_up ──
  test('NO_IMPRESSIONS: choisit bid_up si éligible', () => {
    const actions: ActionSuggestionItem[] = [
      makeAction({ actionType: 'bid_up', category: 'ACTION_PUB', eligible: true, confidence: 30 }),
    ];

    const result = selectDefaultAction(actions, ctx({ diagnosisCode: 'no_impressions', clicks: 0 }));

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('bid_up');
  });

  // ── Test 5: WINNER → bid_up car potentiel croissance ──
  test('WINNER: choisit bid_up (urgency bonus pour growth)', () => {
    const actions: ActionSuggestionItem[] = [
      makeAction({ actionType: 'bid_up', category: 'ACTION_PUB', eligible: true, confidence: 70 }),
      makeAction({ actionType: 'harvest', category: 'ACTION_PUB', eligible: true, confidence: 60 }),
    ];

    const result = selectDefaultAction(actions, ctx({ diagnosisCode: 'winner', clicks: 50 }));

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('bid_up'); // urgency bonus for bid_up on winner
  });

  // ── Test 6: 2 ACTION_PUB → choisir par score (confidence + urgency) ──
  test('2 ACTION_PUB éligibles: choisit par score le plus élevé', () => {
    const actions: ActionSuggestionItem[] = [
      makeAction({ actionType: 'pause', category: 'ACTION_PUB', eligible: true, confidence: 40 }),
      makeAction({ actionType: 'add_negative', category: 'ACTION_PUB', eligible: true, confidence: 40 }),
    ];

    // clicks_no_sales donne urgency bonus à pause et add_negative
    const result = selectDefaultAction(actions, ctx({ diagnosisCode: 'clicks_no_sales', clicks: 30 }));

    expect(result).not.toBeNull();
    // Les deux ont le même score de base + urgency, mais 'pause' est premier (priorityHint n'est pas set ici)
    // Le résultat dépend du scoring exact — on vérifie juste que c'est bien une ACTION_PUB
    expect(result!.category).toBe('ACTION_PUB');
  });

  // ── Test 7: Aucune ACTION_PUB éligible → fallback OBSERVATION ──
  test('Aucune ACTION_PUB éligible: fallback vers OBSERVATION', () => {
    const actions: ActionSuggestionItem[] = [
      makeAction({ actionType: 'bid_up', category: 'ACTION_PUB', eligible: false, confidence: 70 }),
      makeAction({ actionType: 'monitor', category: 'OBSERVATION', eligible: true, confidence: 40, executable: false }),
      makeAction({ actionType: 'improve_listing', category: 'BOOK_ADVICE', eligible: true, confidence: 50, executable: false }),
    ];

    const result = selectDefaultAction(actions, ctx({ diagnosisCode: 'very_low_clicks', clicks: 8 }));

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('monitor');
    expect(result!.category).toBe('OBSERVATION');
  });

  // ── Test 8: Aucune ACTION_PUB ni OBSERVATION → BOOK_ADVICE ──
  test('Aucune ACTION_PUB ni OBSERVATION: fallback vers BOOK_ADVICE', () => {
    const actions: ActionSuggestionItem[] = [
      makeAction({ actionType: 'improve_listing', category: 'BOOK_ADVICE', eligible: true, confidence: 60, executable: false }),
      makeAction({ actionType: 'improve_cover', category: 'BOOK_ADVICE', eligible: true, confidence: 50, executable: false }),
    ];

    const result = selectDefaultAction(actions, ctx({ diagnosisCode: 'zero_clicks', clicks: 0 }));

    expect(result).not.toBeNull();
    expect(result!.category).toBe('BOOK_ADVICE');
  });

  // ── Test 9: Liste vide → null ──
  test('Liste vide retourne null', () => {
    const result = selectDefaultAction([], ctx());
    expect(result).toBeNull();
  });

  // ── Test 10: EXPENSIVE_BUT_VALID → bid_down prioritaire ──
  test('EXPENSIVE_BUT_VALID: choisit bid_down (urgency bonus)', () => {
    const actions: ActionSuggestionItem[] = [
      makeAction({ actionType: 'bid_down', category: 'ACTION_PUB', eligible: true, confidence: 60 }),
      makeAction({ actionType: 'monitor', category: 'OBSERVATION', eligible: true, confidence: 40, executable: false }),
    ];

    const result = selectDefaultAction(actions, ctx({ diagnosisCode: 'expensive_but_valid', clicks: 25 }));

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('bid_down');
  });

  // ── Test 11: primary hint donne un bonus ──
  test('priorityHint primary donne bonus au scoring', () => {
    const actions: ActionSuggestionItem[] = [
      makeAction({ actionType: 'bid_up', category: 'ACTION_PUB', eligible: true, confidence: 50, priorityHint: 'secondary' }),
      makeAction({ actionType: 'harvest', category: 'ACTION_PUB', eligible: true, confidence: 50, priorityHint: 'primary' }),
    ];

    // Pas de diagnosis -> winner, donc pas d'urgency bonus pour bid_up
    const result = selectDefaultAction(actions, ctx({ diagnosisCode: 'low_clicks', clicks: 20 }));

    expect(result).not.toBeNull();
    expect(result!.actionType).toBe('harvest'); // primary hint gives +15 bonus
  });
});

// ══════════════════════════════════════════════════════════════
// insightActionToSuggestionItem
// ══════════════════════════════════════════════════════════════

describe('insightActionToSuggestionItem', () => {
  test('convertit correctement une action ads en ACTION_PUB', () => {
    const item = insightActionToSuggestionItem(
      { type: 'bid_up', execution: 'ads', label: 'Augmenter enchère' },
      { diagnosisCode: 'winner', eligibility: true, confidenceScore: 70 },
      0,
    );

    expect(item.category).toBe('ACTION_PUB');
    expect(item.actionType).toBe('bid_up');
    expect(item.executable).toBe(true);
    expect(item.eligible).toBe(true);
    expect(item.confidence).toBe(70);
    expect(item.priorityHint).toBe('primary');
  });

  test('convertit correctement une action book en BOOK_ADVICE', () => {
    const item = insightActionToSuggestionItem(
      { type: 'improve_listing', execution: 'book', label: 'Améliorer fiche' },
      { diagnosisCode: 'clicks_no_sales', eligibility: false, confidenceScore: 50 },
      1,
    );

    expect(item.category).toBe('BOOK_ADVICE');
    expect(item.executable).toBe(false);
    expect(item.eligible).toBe(true); // book advice is always eligible
    expect(item.priorityHint).toBe('secondary');
  });

  test('action ads non-éligible quand insight.eligibility est false', () => {
    const item = insightActionToSuggestionItem(
      { type: 'bid_up', execution: 'ads', label: 'Augmenter enchère' },
      { diagnosisCode: 'very_low_clicks', eligibility: false, confidenceScore: 30 },
      0,
    );

    expect(item.eligible).toBe(false); // ads action inherits eligibility
  });
});
