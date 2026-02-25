'use strict';

// ── Pure Logic (extracted from LifecycleService) ──────

const ORDERS_THRESHOLD = 10;
const CLICKS_THRESHOLD = 30;
const ACOS_VARIANCE_THRESHOLD = 0.15;
const HYSTERESIS_HOURS = 48;
const MIN_DAYS_IN_PHASE = 7;

function determinePhase(evidence) {
  const { daysSincePublish, ordersTotal30d, clicksTotalAllTime, ordersWeek1, ordersWeek2 } = evidence;

  if (daysSincePublish < 30) return 'launch';
  if (clicksTotalAllTime < CLICKS_THRESHOLD) return 'launch';
  if (ordersTotal30d < ORDERS_THRESHOLD) return 'launch';

  if (daysSincePublish > 180) {
    if (evidence.acosVariance3x30 !== undefined && evidence.acosVariance3x30 < ACOS_VARIANCE_THRESHOLD) {
      return 'evergreen';
    }
    if (ordersTotal30d >= ORDERS_THRESHOLD) {
      return 'evergreen';
    }
  }

  if (daysSincePublish >= 30 && daysSincePublish <= 180) {
    if (ordersTotal30d >= ORDERS_THRESHOLD && ordersWeek1 > 0 && ordersWeek2 > 0) {
      return 'scale';
    }
    return 'launch';
  }

  return 'launch';
}

function shouldApplyChange(candidatePhase, currentPhase, pendingPhase, pendingSinceHours, daysInCurrentPhase) {
  if (candidatePhase === currentPhase) {
    return { apply: false, reason: 'Same phase' };
  }
  if ((daysInCurrentPhase || 0) < MIN_DAYS_IN_PHASE) {
    return { apply: false, reason: 'Cooldown: ' + daysInCurrentPhase + '/' + MIN_DAYS_IN_PHASE + ' days in current phase' };
  }
  if (pendingPhase === candidatePhase && pendingSinceHours !== null && pendingSinceHours >= HYSTERESIS_HOURS) {
    return { apply: true, reason: 'Hysteresis satisfied' };
  }
  return { apply: false, reason: 'Pending hysteresis' };
}

// ── Tests ─────────────────────────────────────────────

let passed = 0;
let failed = 0;

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
  if (actual !== expected) {
    throw new Error(label + ': expected "' + expected + '", got "' + actual + '"');
  }
}

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

console.log('Lifecycle Unit Tests\n');

test('1. Launch → Scale when conditions met + hysteresis satisfied', function() {
  var candidate = determinePhase({
    daysSincePublish: 45, ordersTotalAllTime: 30, ordersTotal30d: 15,
    clicksTotalAllTime: 200, ordersWeek1: 5, ordersWeek2: 4,
  });
  assertEqual(candidate, 'scale', 'Phase');
  var result = shouldApplyChange(candidate, 'launch', 'scale', 72, 10);
  assert(result.apply, 'Should apply');
});

test('2. Scale → Evergreen after 180d + stable ACoS', function() {
  var candidate = determinePhase({
    daysSincePublish: 200, ordersTotalAllTime: 300, ordersTotal30d: 25,
    clicksTotalAllTime: 2000, ordersWeek1: 8, ordersWeek2: 7, acosVariance3x30: 0.08,
  });
  assertEqual(candidate, 'evergreen', 'Phase');
});

test('3. Hysteresis blocks if pending < 48h', function() {
  var result = shouldApplyChange('scale', 'launch', 'scale', 24, 10);
  assert(!result.apply, 'Should NOT apply');
});

test('4. Cooldown blocks if < 7d in current phase', function() {
  var result = shouldApplyChange('scale', 'launch', 'scale', 72, 3);
  assert(!result.apply, 'Should NOT apply');
});

test('5. Manual override: determinePhase still computes but service bypasses', function() {
  var candidate = determinePhase({
    daysSincePublish: 200, ordersTotalAllTime: 500, ordersTotal30d: 50,
    clicksTotalAllTime: 5000, ordersWeek1: 20, ordersWeek2: 15, acosVariance3x30: 0.05,
  });
  assertEqual(candidate, 'evergreen', 'Pure logic says evergreen');
});

test('6. Reset to auto triggers recomputation', function() {
  var candidate = determinePhase({
    daysSincePublish: 200, ordersTotalAllTime: 500, ordersTotal30d: 50,
    clicksTotalAllTime: 5000, ordersWeek1: 20, ordersWeek2: 15, acosVariance3x30: 0.05,
  });
  assertEqual(candidate, 'evergreen', 'After reset');
});

test('7. Launch maintained if orders < 10 even after > 30 days', function() {
  var candidate = determinePhase({
    daysSincePublish: 60, ordersTotalAllTime: 5, ordersTotal30d: 3,
    clicksTotalAllTime: 100, ordersWeek1: 1, ordersWeek2: 1,
  });
  assertEqual(candidate, 'launch', 'Phase');
});

test('8. Insufficient clicks keeps Launch regardless of time', function() {
  var candidate = determinePhase({
    daysSincePublish: 100, ordersTotalAllTime: 20, ordersTotal30d: 15,
    clicksTotalAllTime: 20, ordersWeek1: 5, ordersWeek2: 5,
  });
  assertEqual(candidate, 'launch', 'Phase');
});

console.log('\n' + passed + '/' + (passed + failed) + ' tests passed');
if (failed > 0) process.exit(1);
