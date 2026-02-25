/**
 * Tests unitaires : Batch Actions Controller logic
 * Vérifie la transformation des suggestions et le batch execute flow
 */

// ── Helpers pour simuler les réponses ActionSuggestionResponse ──

function makeActionSuggestionResponse({
  entityKey,
  entityType = 'keyword',
  entityName = 'test keyword',
  currentBid = 0.75,
  recommendedBid = 0.85,
  eligibility = 'full_calculation',
  cooldownActive = false,
  diagnosisCode = 'bid_up_profitable',
}) {
  return {
    entityKey,
    entityType,
    entityName,
    diagnosisCode,
    eligibility,
    currentBid,
    bidCalculation: {
      eligibility,
      recommendedBid,
      currentBid,
    },
    cooldown: cooldownActive
      ? { active: true, daysSinceChange: 1, cooldownDays: 5, remainingDays: 4, lastChangeType: 'bid_up', previousBid: 0.50, newBid: 0.75, lastChangeAt: new Date().toISOString() }
      : null,
    metrics: { impressions: 1000, clicks: 50, orders: 5, spend: 20, sales: 50, acos: 40, ctr: 5, cvr: 10, periodDays: 14 },
    availableActions: [],
  };
}

// ── Transform logic (matches controller code) ──

function transformToSimplified(r) {
  const hasCooldown = r.cooldown?.active === true;
  const calc = r.bidCalculation;
  const recommendedBid = calc?.recommendedBid ?? null;

  const eligibilityStr = r.eligibility;
  const eligible = !hasCooldown
    && eligibilityStr !== 'insufficient_data'
    && eligibilityStr !== 'cooldown'
    && recommendedBid !== null;

  let direction = null;
  if (recommendedBid !== null && r.currentBid > 0) {
    direction = recommendedBid > r.currentBid ? 'bid_up' : recommendedBid < r.currentBid ? 'bid_down' : null;
  }

  return {
    entityKey: r.entityKey,
    entityType: r.entityType,
    entityName: r.entityName,
    diagnosisCode: r.diagnosisCode,
    currentBid: r.currentBid,
    recommendedBid,
    direction,
    eligible,
    reason: !eligible ? (eligibilityStr === 'insufficient_data' ? 'Données insuffisantes' : eligibilityStr === 'cooldown' ? 'En observation' : undefined) : undefined,
    cooldownActive: hasCooldown,
  };
}

// ── Tests ──

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('Batch Actions Tests:');

test('bid_up: eligible entity with higher recommended bid → direction bid_up', () => {
  const r = makeActionSuggestionResponse({
    entityKey: 'keyword:1001',
    currentBid: 0.50,
    recommendedBid: 0.65,
    eligibility: 'full_calculation',
  });
  const s = transformToSimplified(r);
  assert(s.eligible === true, 'should be eligible');
  assert(s.direction === 'bid_up', `direction should be bid_up, got ${s.direction}`);
  assert(s.recommendedBid === 0.65, 'recommended bid should be 0.65');
  assert(s.cooldownActive === false, 'should not be in cooldown');
});

test('bid_down: eligible entity with lower recommended bid → direction bid_down', () => {
  const r = makeActionSuggestionResponse({
    entityKey: 'keyword:1002',
    currentBid: 1.00,
    recommendedBid: 0.75,
    eligibility: 'full_calculation',
  });
  const s = transformToSimplified(r);
  assert(s.eligible === true, 'should be eligible');
  assert(s.direction === 'bid_down', `direction should be bid_down, got ${s.direction}`);
});

test('same bid: eligible but no direction', () => {
  const r = makeActionSuggestionResponse({
    entityKey: 'keyword:1003',
    currentBid: 0.75,
    recommendedBid: 0.75,
    eligibility: 'full_calculation',
  });
  const s = transformToSimplified(r);
  assert(s.eligible === true, 'should be eligible');
  assert(s.direction === null, `direction should be null, got ${s.direction}`);
});

test('cooldown active: NOT eligible, cooldownActive true', () => {
  const r = makeActionSuggestionResponse({
    entityKey: 'keyword:1004',
    currentBid: 0.50,
    recommendedBid: 0.65,
    eligibility: 'cooldown',
    cooldownActive: true,
  });
  const s = transformToSimplified(r);
  assert(s.eligible === false, 'should NOT be eligible');
  assert(s.cooldownActive === true, 'should be in cooldown');
});

test('insufficient_data: NOT eligible', () => {
  const r = makeActionSuggestionResponse({
    entityKey: 'keyword:1005',
    currentBid: 0.50,
    recommendedBid: null,
    eligibility: 'insufficient_data',
  });
  const s = transformToSimplified(r);
  assert(s.eligible === false, 'should NOT be eligible');
  assert(s.direction === null, 'direction should be null');
  assert(s.reason === 'Données insuffisantes', `reason should be set, got ${s.reason}`);
});

test('observe_only: eligible but may have null recommendedBid', () => {
  const r = makeActionSuggestionResponse({
    entityKey: 'keyword:1006',
    currentBid: 0.50,
    recommendedBid: null,
    eligibility: 'observe_only',
  });
  const s = transformToSimplified(r);
  // observe_only with null recommendedBid → not eligible (because recommendedBid is null)
  assert(s.eligible === false, 'should NOT be eligible (null recommendedBid)');
});

test('small_tweak_max: eligible with recommendation', () => {
  const r = makeActionSuggestionResponse({
    entityKey: 'keyword:1007',
    currentBid: 0.50,
    recommendedBid: 0.55,
    eligibility: 'small_tweak_max',
  });
  const s = transformToSimplified(r);
  assert(s.eligible === true, 'should be eligible');
  assert(s.direction === 'bid_up', `direction should be bid_up, got ${s.direction}`);
});

test('batch filtering: only selected + eligible + with direction should be included', () => {
  const responses = [
    makeActionSuggestionResponse({ entityKey: 'keyword:1', currentBid: 0.50, recommendedBid: 0.65, eligibility: 'full_calculation' }),
    makeActionSuggestionResponse({ entityKey: 'keyword:2', currentBid: 0.50, recommendedBid: null, eligibility: 'insufficient_data' }),
    makeActionSuggestionResponse({ entityKey: 'keyword:3', currentBid: 1.00, recommendedBid: 0.80, eligibility: 'full_calculation', cooldownActive: true }),
    makeActionSuggestionResponse({ entityKey: 'keyword:4', currentBid: 0.75, recommendedBid: 0.75, eligibility: 'full_calculation' }),
    makeActionSuggestionResponse({ entityKey: 'keyword:5', currentBid: 0.90, recommendedBid: 0.70, eligibility: 'full_calculation' }),
  ];

  const simplified = responses.map(transformToSimplified);
  // Simulate: all selected
  const selectedKeys = new Set(simplified.map(s => s.entityKey));

  const actionsToExecute = simplified.filter(
    s => selectedKeys.has(s.entityKey) && s.eligible && s.direction && s.recommendedBid != null
  );

  // Only keyword:1 (bid_up), keyword:5 (bid_down) should be in the list
  // keyword:2 → not eligible (insufficient_data)
  // keyword:3 → not eligible (cooldown)
  // keyword:4 → eligible but direction is null (same bid)
  assert(actionsToExecute.length === 2, `expected 2 actionable, got ${actionsToExecute.length}`);
  assert(actionsToExecute[0].entityKey === 'keyword:1', 'first should be keyword:1');
  assert(actionsToExecute[1].entityKey === 'keyword:5', 'second should be keyword:5');
});

console.log('\nDone!');
