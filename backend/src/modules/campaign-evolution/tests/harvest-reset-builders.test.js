/**
 * Tests unitaires : HarvestPlanBuilder & ResetPlanBuilder
 * 20 tests covering HARVEST mode, RESET mode, bid computation, explanations
 */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
    process.exitCode = 1;
  }
}

// ── Mock data factories ─────────────────────────────────────────

function makeKeyword(id, text, matchType, state = 'enabled') {
  return { id, amazonKeywordId: 100 + parseInt(id), keywordText: text, matchType, state, bid: 0.5 };
}

function makeTarget(id, expressionType, expression, state = 'enabled') {
  return { id, amazonTargetId: 200 + parseInt(id), expressionType, expression, state, bid: 0.5 };
}

function makeAdGroup(id, keywords = [], targets = []) {
  return { id, name: 'AG-' + id, state: 'enabled', defaultBid: 0.5, keywords, targets };
}

function makeCampaign(id, adGroups = [], opts = {}) {
  return {
    id,
    name: opts.name || 'Campaign-' + id,
    campaignType: opts.campaignType || 'sponsoredProducts',
    targetingType: opts.targetingType || 'manual',
    state: opts.state || 'enabled',
    dailyBudget: opts.dailyBudget || 10,
    startDate: null,
    adGroups,
  };
}

function makeCtx(campaigns = [], insightsMap = new Map(), opts = {}) {
  return {
    scenario: opts.scenario || 'scenario_stable',
    bookContext: {
      id: 'book-1',
      title: opts.title || 'Le Silence des Abysses',
      asin: 'B001',
      lifecyclePhase: opts.lifecycle || 'launch',
      acosTarget: opts.acosTarget || 30,
      royaltyPerUnit: 3.5,
      salePrice: 9.99,
    },
    campaigns,
    entityInsightsMap: insightsMap,
    duplicationScore: 0,
    chaosScore: 0,
    campaignRoles: [],
    maturityScore: 50,
    context: {
      lifecyclePhase: opts.lifecycle || 'launch',
      totalCampaigns: campaigns.length,
      totalAdGroups: 1,
      totalKeywords: 5,
      totalProductTargets: 0,
      totalWinnerKeywords: 0,
      totalBoostCandidateKeywords: 0,
    },
    gaps: [],
  };
}

function makeHarvest(overrides = {}) {
  return {
    winnerKeywords: overrides.winnerKeywords || [],
    winnerSearchTerms: overrides.winnerSearchTerms || [],
    winnerAsins: overrides.winnerAsins || [],
    suggestedNegatives: overrides.suggestedNegatives || [],
    windowDays: overrides.windowDays || 14,
    avgWinningBid: overrides.avgWinningBid !== undefined ? overrides.avgWinningBid : null,
    avgCpcObserved: overrides.avgCpcObserved !== undefined ? overrides.avgCpcObserved : null,
    topPlacementPerformance: overrides.topPlacementPerformance !== undefined ? overrides.topPlacementPerformance : null,
    userProvidedKeywords: overrides.userProvidedKeywords || ['silence', 'abysses', 'roman'],
  };
}

// ── Load Builders ────────────────────────────────────────────────

const { HarvestPlanBuilderService } = require('../services/harvest-plan-builder.service');
const { ResetPlanBuilderService } = require('../services/reset-plan-builder.service');

const harvestBuilder = new HarvestPlanBuilderService();
const resetBuilder = new ResetPlanBuilderService();

// ══════════════════════════════════════════════════════════════════
//  HARVEST MODE TESTS
// ══════════════════════════════════════════════════════════════════

console.log('\n📌 HARVEST Mode — Campaign Structure');

test('HARVEST with winners → creates SP Exact', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({
    winnerKeywords: [
      { text: 'thriller', matchType: 'exact', acos: 15, orders: 5, campaignId: 'c1' },
      { text: 'roman noir', matchType: 'broad', acos: 20, orders: 3, campaignId: 'c1' },
    ],
    avgWinningBid: 0.65,
  });

  const plan = harvestBuilder.buildPlan(ctx, harvest);
  const types = plan.map(c => c.type);
  assert(types.includes('SP_MANUAL_EXACT'), 'Expected SP_MANUAL_EXACT when winners exist');
  const exactCamp = plan.find(c => c.type === 'SP_MANUAL_EXACT');
  assert(exactCamp.seedKeywords.includes('thriller'), 'Expected winner keyword in Exact seeds');
});

test('HARVEST without winners → no SP Exact', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'launch' });
  const harvest = makeHarvest({
    winnerKeywords: [],
    winnerSearchTerms: [],
  });

  const plan = harvestBuilder.buildPlan(ctx, harvest);
  const types = plan.map(c => c.type);
  assert(!types.includes('SP_MANUAL_EXACT'), 'Expected NO SP_MANUAL_EXACT without winners');
  assert(types.includes('SP_AUTO'), 'Expected SP_AUTO always');
});

test('HARVEST always creates SP Auto', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'launch' });
  const harvest = makeHarvest({});

  const plan = harvestBuilder.buildPlan(ctx, harvest);
  const autoTypes = plan.filter(c => c.type === 'SP_AUTO');
  assert(autoTypes.length === 1, 'Expected exactly 1 SP_AUTO');
});

test('HARVEST with ASINs → creates SP Product', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({
    winnerAsins: ['B00ASIN1', 'B00ASIN2'],
  });

  const plan = harvestBuilder.buildPlan(ctx, harvest);
  const productCamp = plan.find(c => c.type === 'SP_PRODUCT');
  assert(productCamp, 'Expected SP_PRODUCT when ASINs exist');
  assert(productCamp.seedAsins.length === 2, 'Expected 2 ASINs');
});

test('HARVEST without ASINs → no SP Product', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'launch' });
  const harvest = makeHarvest({ winnerAsins: [] });

  const plan = harvestBuilder.buildPlan(ctx, harvest);
  assert(!plan.some(c => c.type === 'SP_PRODUCT'), 'Expected NO SP_PRODUCT without ASINs');
});

test('HARVEST with seeds → creates SP Expression', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({
    winnerKeywords: [{ text: 'word1', matchType: 'broad', orders: 2, campaignId: 'c1' }],
    userProvidedKeywords: ['title', 'words'],
  });

  const plan = harvestBuilder.buildPlan(ctx, harvest);
  assert(plan.some(c => c.type === 'SP_MANUAL_BROAD'), 'Expected SP_MANUAL_BROAD with seeds');
});

console.log('\n📌 HARVEST Mode — Bid Computation');

test('HARVEST bid = avgWinningBid directly (no multiplier) for winners', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({
    winnerKeywords: [{ text: 'kw', matchType: 'exact', acos: 15, orders: 5, campaignId: 'c1' }],
    avgWinningBid: 0.72,
    avgCpcObserved: 0.55,
  });

  const plan = harvestBuilder.buildPlan(ctx, harvest);
  const exactCamp = plan.find(c => c.type === 'SP_MANUAL_EXACT');
  assert(exactCamp, 'Expected SP_MANUAL_EXACT');
  assert(exactCamp.defaultBid === 0.72, `Expected bid 0.72 (avgWinningBid), got ${exactCamp.defaultBid}`);
});

test('HARVEST bid = avgCpcObserved for manual (non-winner) campaigns', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({
    avgCpcObserved: 0.48,
    userProvidedKeywords: ['test'],
  });

  const plan = harvestBuilder.buildPlan(ctx, harvest);
  const broadCamp = plan.find(c => c.type === 'SP_MANUAL_BROAD');
  assert(broadCamp, 'Expected SP_MANUAL_BROAD');
  assert(broadCamp.defaultBid === 0.48, `Expected bid 0.48 (avgCpcObserved), got ${broadCamp.defaultBid}`);
});

test('HARVEST bid falls back to lifecycle default when no data', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'launch' });
  const harvest = makeHarvest({
    avgWinningBid: null,
    avgCpcObserved: null,
    userProvidedKeywords: ['test'],
  });

  const plan = harvestBuilder.buildPlan(ctx, harvest);
  const broadCamp = plan.find(c => c.type === 'SP_MANUAL_BROAD');
  assert(broadCamp, 'Expected SP_MANUAL_BROAD');
  // Launch default bid = 0.45
  assert(broadCamp.defaultBid === 0.45, `Expected bid 0.45 (lifecycle default), got ${broadCamp.defaultBid}`);
});

console.log('\n📌 HARVEST Mode — Placement Boost');

test('HARVEST placement boost only if topPlacementPerformance > 1.0', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvestWithBoost = makeHarvest({ topPlacementPerformance: 1.5, userProvidedKeywords: ['test'] });
  const planWithBoost = harvestBuilder.buildPlan(ctx, harvestWithBoost);
  const autoCampBoost = planWithBoost.find(c => c.type === 'SP_AUTO');
  assert(autoCampBoost.placementAdjustments, 'Expected placement adjustments when ratio > 1.0');
  assert(autoCampBoost.placementAdjustments.topOfSearch >= 20, 'Expected top boost >= 20%');

  const harvestNoBoost = makeHarvest({ topPlacementPerformance: 0.8, userProvidedKeywords: ['test'] });
  const planNoBoost = harvestBuilder.buildPlan(ctx, harvestNoBoost);
  const autoCampNoBoost = planNoBoost.find(c => c.type === 'SP_AUTO');
  assert(!autoCampNoBoost.placementAdjustments, 'Expected NO placement when ratio < 1.0');
});

// ══════════════════════════════════════════════════════════════════
//  RESET MODE TESTS
// ══════════════════════════════════════════════════════════════════

console.log('\n📌 RESET Mode — Launch/Relaunch Structure');

test('RESET launch → Auto + Expression, NO Exact', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'launch' });
  const harvest = makeHarvest({ userProvidedKeywords: ['silence', 'abysses'] });

  const plan = resetBuilder.buildPlan(ctx, harvest);
  const types = plan.map(c => c.type);
  assert(types.includes('SP_AUTO'), 'Expected SP_AUTO');
  assert(types.includes('SP_MANUAL_BROAD'), 'Expected SP_MANUAL_BROAD (Expression)');
  assert(!types.includes('SP_MANUAL_EXACT'), 'Expected NO SP_MANUAL_EXACT in launch');
  assert(!types.includes('SP_PRODUCT'), 'Expected NO SP_PRODUCT in launch');
});

test('RESET relaunch → same as launch (Auto + Expression, NO Exact)', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'relaunch' });
  const harvest = makeHarvest({ userProvidedKeywords: ['silence'] });

  const plan = resetBuilder.buildPlan(ctx, harvest);
  const types = plan.map(c => c.type);
  assert(types.includes('SP_AUTO'), 'Expected SP_AUTO');
  assert(!types.includes('SP_MANUAL_EXACT'), 'Expected NO SP_MANUAL_EXACT in relaunch');
});

console.log('\n📌 RESET Mode — Scale Structure');

test('RESET scale + userProvidedKeywords → Auto + Expression + Exact', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({ userProvidedKeywords: ['thriller', 'psychologique', 'suspense'] });

  const plan = resetBuilder.buildPlan(ctx, harvest);
  const types = plan.map(c => c.type);
  assert(types.includes('SP_AUTO'), 'Expected SP_AUTO');
  assert(types.includes('SP_MANUAL_BROAD'), 'Expected SP_MANUAL_BROAD');
  assert(types.includes('SP_MANUAL_EXACT'), 'Expected SP_MANUAL_EXACT in scale with keywords');
});

test('RESET scale without keywords → only Auto', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({ userProvidedKeywords: [] });

  const plan = resetBuilder.buildPlan(ctx, harvest);
  const types = plan.map(c => c.type);
  assert(types.includes('SP_AUTO'), 'Expected SP_AUTO');
  assert(!types.includes('SP_MANUAL_BROAD'), 'Expected NO Expression without keywords');
  assert(!types.includes('SP_MANUAL_EXACT'), 'Expected NO Exact without keywords');
});

console.log('\n📌 RESET Mode — Evergreen Structure');

test('RESET evergreen → Exact (priority) + Product + Auto (low budget)', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'evergreen' });
  const harvest = makeHarvest({ userProvidedKeywords: ['roman', 'noir'] });

  const plan = resetBuilder.buildPlan(ctx, harvest);
  const types = plan.map(c => c.type);
  assert(types.includes('SP_MANUAL_EXACT'), 'Expected SP_MANUAL_EXACT (priority in evergreen)');
  assert(types.includes('SP_PRODUCT'), 'Expected SP_PRODUCT');
  assert(types.includes('SP_AUTO'), 'Expected SP_AUTO');

  // Auto should have low budget (capped at 8)
  const autoCamp = plan.find(c => c.type === 'SP_AUTO');
  assert(autoCamp.dailyBudget <= 8, `Expected Auto budget <= 8 in evergreen, got ${autoCamp.dailyBudget}`);
});

test('RESET uses lifecycle defaults for bids (never real data)', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({
    userProvidedKeywords: ['test'],
    avgWinningBid: 0.99,      // Should be IGNORED in RESET
    avgCpcObserved: 0.88,     // Should be IGNORED in RESET
  });

  const plan = resetBuilder.buildPlan(ctx, harvest);
  // scale default bid = 0.55
  const autoCamp = plan.find(c => c.type === 'SP_AUTO');
  // Auto = defaultBid * 0.9 = 0.55 * 0.9 = 0.495 → clamped to 0.50
  assert(autoCamp.defaultBid < 0.88, `RESET should NOT use avgCpcObserved (0.88), got ${autoCamp.defaultBid}`);
});

console.log('\n📌 Explanations');

test('HARVEST explanations include real_data source for winner bids', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({
    winnerKeywords: [{ text: 'kw', matchType: 'exact', acos: 15, orders: 5, campaignId: 'c1' }],
    avgWinningBid: 0.72,
  });

  const plan = harvestBuilder.buildPlan(ctx, harvest);
  const exactCamp = plan.find(c => c.type === 'SP_MANUAL_EXACT');
  assert(exactCamp, 'Expected Exact campaign');
  const bidExplanation = exactCamp.explanations.find(e => e.parameter === 'bid');
  assert(bidExplanation, 'Expected bid explanation');
  assert(bidExplanation.dataSource === 'real_data', `Expected real_data, got ${bidExplanation.dataSource}`);
});

test('RESET explanations use lifecycle_default or inferred source', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'launch' });
  const harvest = makeHarvest({ userProvidedKeywords: ['test'] });

  const plan = resetBuilder.buildPlan(ctx, harvest);
  for (const camp of plan) {
    for (const exp of camp.explanations) {
      assert(
        exp.dataSource !== 'real_data',
        `RESET should never have real_data source, found in ${camp.name} → ${exp.parameter}`,
      );
    }
  }
});

test('Every campaign has at least type, bid, budget, biddingStrategy explanations', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({
    winnerKeywords: [{ text: 'kw', matchType: 'exact', acos: 15, orders: 5, campaignId: 'c1' }],
    avgWinningBid: 0.60,
    winnerAsins: ['B00TEST'],
    userProvidedKeywords: ['test'],
  });

  const plan = harvestBuilder.buildPlan(ctx, harvest);
  for (const camp of plan) {
    const params = camp.explanations.map(e => e.parameter);
    assert(params.includes('type'), `${camp.name}: missing type explanation`);
    assert(params.includes('bid'), `${camp.name}: missing bid explanation`);
    assert(params.includes('budget'), `${camp.name}: missing budget explanation`);
    assert(params.includes('biddingStrategy'), `${camp.name}: missing biddingStrategy explanation`);
  }
});

// ── Summary ──────────────────────────────────────────────────────

console.log('\n───────────────────────────────────────────────────────');
console.log(`✅ ${passed} passed, ❌ ${failed} failed — Total: ${passed + failed}`);
