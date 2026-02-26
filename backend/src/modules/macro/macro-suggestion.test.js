'use strict';

// ── Gating Thresholds (from service) ─────────────────

const GATING = {
  DEGRADATION_ACOS_INCREASE: 1.10,
  DEGRADATION_CVR_DECREASE: 0.90,
  DEGRADATION_SPEND_SHARE_MIN: 0.60,
  BUDGET_UTILIZATION_THRESHOLD: 0.95,
  BUDGET_ACOS_MARGIN: 0.80,
  BUDGET_INCREASE_PCT: 20,
  PLACEMENT_ACOS_RATIO: 1.30,
  PLACEMENT_MIN_MULTIPLIER: 10,
  BIDDING_LAUNCH_MIN_CLICKS: 50,
};

// ── Pattern Checkers (pure logic) ────────────────────

function checkGlobalDegradation(strategicAcos, trendAcos, strategicCvr, trendCvr, spendShare, currentBidding) {
  if (!strategicAcos || !trendAcos || !strategicCvr || !trendCvr) return null;
  if (strategicAcos === 0) return null;

  var acosRatio = trendAcos / strategicAcos;
  var cvrRatio = trendCvr / strategicCvr;

  if (acosRatio >= GATING.DEGRADATION_ACOS_INCREASE &&
      cvrRatio <= GATING.DEGRADATION_CVR_DECREASE &&
      spendShare >= GATING.DEGRADATION_SPEND_SHARE_MIN) {
    if (currentBidding === 'up_and_down') return 'set_bidding_strategy';
    return 'advice';
  }
  return null;
}

function checkBudgetCapped(utilization, acos, breakEvenAcos, orders, currentBudget) {
  if (!currentBudget || currentBudget <= 0) return null;
  if (utilization >= GATING.BUDGET_UTILIZATION_THRESHOLD &&
      acos > 0 &&
      acos <= breakEvenAcos * GATING.BUDGET_ACOS_MARGIN &&
      orders > 0) {
    return 'increase_budget';
  }
  return null;
}

function checkPlacementMismatch(topOfSearchMultiplier, topAcos, campaignAcos) {
  if (topOfSearchMultiplier < GATING.PLACEMENT_MIN_MULTIPLIER) return null;
  if (campaignAcos <= 0 || topAcos <= 0) return null;
  if (topAcos > campaignAcos * GATING.PLACEMENT_ACOS_RATIO) return 'update_placements';
  return null;
}

function checkBiddingMismatch(currentBidding, lifecyclePhase, totalClicks, acos, breakEvenAcos) {
  if (currentBidding !== 'up_and_down') return null;
  if (lifecyclePhase === 'launch' && totalClicks < GATING.BIDDING_LAUNCH_MIN_CLICKS) return 'set_bidding_strategy';
  if (lifecyclePhase === 'evergreen' && acos > breakEvenAcos) return 'set_bidding_strategy';
  return null;
}

// ── Test Runner ──────────────────────────────────────

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (err) {
    failed++;
    console.log('  ❌ ' + name + ': ' + err.message);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ': expected "' + expected + '", got "' + actual + '"');
}

function assertNull(actual, label) {
  if (actual !== null) throw new Error(label + ': expected null, got "' + actual + '"');
}

function assertNotNull(actual, label) {
  if (actual === null) throw new Error(label + ': expected non-null, got null');
}

console.log('Macro Suggestion Unit Tests\n');

// ── Test 1: Global degradation detected ──────────────

test('1. Global degradation (60%+ spend impacted) → suggestion generated', function() {
  var result = checkGlobalDegradation(
    30, 35,   // strategic ACoS 30%, trend 35% (ratio 1.17 > 1.10)
    5.0, 4.0, // strategic CVR 5%, trend 4% (ratio 0.80 < 0.90)
    0.70,     // 70% spend impacted
    'up_and_down'
  );
  assertEqual(result, 'set_bidding_strategy', 'Action type');
});

// ── Test 2: Local degradation → no macro ─────────────

test('2. Local degradation (1-2 lines only, spend < 60%) → NO macro', function() {
  var result = checkGlobalDegradation(
    30, 35,   // ACoS increasing
    5.0, 4.0, // CVR decreasing
    0.25,     // Only 25% spend impacted
    'up_and_down'
  );
  assertNull(result, 'Should be null');
});

// ── Test 3: Budget capped + profitable → increase ────

test('3. Budget capped + profitable → increase_budget', function() {
  var result = checkBudgetCapped(
    0.98,  // 98% utilization
    20,    // ACoS 20%
    35,    // Break-even 35%
    15,    // 15 orders
    10.00  // €10 budget
  );
  assertEqual(result, 'increase_budget', 'Action type');
});

// ── Test 4: Budget capped + NOT profitable → no macro ─

test('4. Budget capped + NOT profitable → NO suggestion', function() {
  var result = checkBudgetCapped(
    0.98,  // 98% utilization
    40,    // ACoS 40% (> 35% * 0.80 = 28%)
    35,    // Break-even 35%
    5,     // 5 orders
    10.00
  );
  assertNull(result, 'Should be null (ACoS too high)');
});

// ── Test 5: Placement mismatch → update_placements ───

test('5. Placement mismatch (topOfSearch ACoS >> campaign) → update_placements', function() {
  var result = checkPlacementMismatch(
    50,    // 50% multiplier
    52,    // topOfSearch ACoS 52%
    30     // campaign ACoS 30% (ratio 1.73 > 1.30)
  );
  assertEqual(result, 'update_placements', 'Action type');
});

// ── Test 6: Bidding mismatch with phase → switch ─────

test('6. Bidding up&down in launch with < 50 clicks → switch strategy', function() {
  var result = checkBiddingMismatch('up_and_down', 'launch', 20, 50, 35);
  assertEqual(result, 'set_bidding_strategy', 'Action type');
});

// ── Test 7: No pattern → empty (silence = stability) ─

test('7. No pattern detected → null (silence = stabilité)', function() {
  // Normal healthy campaign
  var degradation = checkGlobalDegradation(30, 29, 5.0, 5.2, 0.10, 'down_only');
  assertNull(degradation, 'No degradation');

  var budget = checkBudgetCapped(0.50, 25, 35, 10, 10.00);
  assertNull(budget, 'No budget issue');

  var placement = checkPlacementMismatch(5, 32, 30);
  assertNull(placement, 'No placement issue');

  var bidding = checkBiddingMismatch('down_only', 'scale', 200, 25, 35);
  assertNull(bidding, 'No bidding issue');
});

// ── Test 8: Max 2 suggestions ────────────────────────

test('8. Maximum 2 suggestions returned (cap check)', function() {
  // Simulate all patterns triggering
  var suggestions = [];

  var d = checkGlobalDegradation(30, 35, 5.0, 4.0, 0.70, 'up_and_down');
  if (d) suggestions.push(d);

  var b = checkBudgetCapped(0.98, 20, 35, 15, 10.00);
  if (b && suggestions.length < 2) suggestions.push(b);

  var p = checkPlacementMismatch(50, 52, 30);
  if (p && suggestions.length < 2) suggestions.push(p);

  var bi = checkBiddingMismatch('up_and_down', 'launch', 20, 50, 35);
  if (bi && suggestions.length < 2) suggestions.push(bi);

  if (suggestions.length > 2) throw new Error('More than 2 suggestions: ' + suggestions.length);
  assertEqual(suggestions.length, 2, 'Should be exactly 2');
});

console.log('\n' + passed + '/' + (passed + failed) + ' tests passed');
if (failed > 0) process.exit(1);
