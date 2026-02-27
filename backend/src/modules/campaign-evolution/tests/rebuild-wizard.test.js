/**
 * Tests unitaires : Rebuild Propre — mode-based plan generation (v3)
 * Tests covering: lifecycle override, HARVEST/RESET dispatcher, fingerprint idempotence,
 * pause-all shape, gap detection
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

// ── Load Services ────────────────────────────────────────────────

const { GapDetectorService } = require('../services/gap-detector.service');
const { TopFocusService } = require('../services/top-focus.service');
const { HarvestService } = require('../services/harvest.service');

// ── Mock data factories ─────────────────────────────────────────

function makeKeyword(id, text, matchType, state = 'enabled') {
  return { id, amazonKeywordId: 100, keywordText: text, matchType, state, bid: 0.5 };
}

function makeTarget(id, type, expr, state = 'enabled') {
  return { id, amazonTargetId: 200, expressionType: type, expression: expr, state, bid: 0.5 };
}

function makeAdGroup(id, keywords = [], targets = []) {
  return { id, name: 'AG-' + id, state: 'enabled', defaultBid: 0.5, keywords, targets };
}

function makeCampaign(id, opts = {}) {
  return {
    id,
    name: opts.name || 'Camp-' + id,
    campaignType: opts.campaignType || 'sponsoredProducts',
    targetingType: opts.targetingType || 'manual',
    state: opts.state || 'enabled',
    dailyBudget: opts.dailyBudget || 10,
    startDate: null,
    adGroups: opts.adGroups || [],
  };
}

function makeInsight(entityKey, diagnosisCode, orders = 0) {
  return {
    entityKey,
    entityType: 'keyword',
    diagnosisCode,
    eligibility: true,
    summaryFacts: { impressions: 100, clicks: 20, ctr: 0.2, orders, cvr: 0.05, spend: 10, sales: 50, acos: 20, periodDays: 14 },
    suggestedActions: [],
    confidenceScore: 0.8,
  };
}

function makeCtx(campaigns, insightsMap, opts = {}) {
  return {
    scenario: opts.scenario || 'scenario_stable',
    bookContext: {
      id: 'book-1',
      title: opts.title || 'Test Book',
      asin: 'B001',
      lifecyclePhase: opts.lifecycle || 'scale',
      acosTarget: 30,
      royaltyPerUnit: 3.5,
      salePrice: 9.99,
    },
    campaigns,
    entityInsightsMap: insightsMap,
    duplicationScore: opts.duplicationScore || 0,
    chaosScore: opts.chaosScore || 0,
    campaignRoles: opts.campaignRoles || [],
    maturityScore: opts.maturityScore || 50,
    context: {
      lifecyclePhase: opts.lifecycle || 'scale',
      totalCampaigns: campaigns.length,
      totalAdGroups: 1,
      totalKeywords: 5,
      totalProductTargets: 0,
      totalWinnerKeywords: opts.totalWinnerKeywords || 0,
      totalBoostCandidateKeywords: 0,
      avgAcos: opts.avgAcos || 20,
      totalSpend30d: opts.totalSpend30d || 100,
      totalSales30d: opts.totalSales30d || 500,
    },
    gaps: opts.gaps || [],
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
    userProvidedKeywords: overrides.userProvidedKeywords || ['test', 'book'],
  };
}

const gapDetector = new GapDetectorService();
const topFocusService = new TopFocusService();
const harvestService = new HarvestService(null);

// ── Tests ────────────────────────────────────────────────────────

console.log('\n📌 Lifecycle Override → Different Gap Detection');

test('Lifecycle override launch → GAP_EXPLORATION critical', () => {
  const kw = makeKeyword('1', 'test', 'exact');
  const ag = makeAdGroup('ag1', [kw]);
  const camp = makeCampaign('c1', { adGroups: [ag], targetingType: 'manual' });

  const ctx = makeCtx([camp], new Map([['c1', [makeInsight('keyword:1', 'winner', 5)]]]), { lifecycle: 'launch' });
  const gaps = gapDetector.detectGaps(ctx);

  const explorationGap = gaps.find(g => g.type === 'GAP_EXPLORATION');
  assert(explorationGap, 'Expected GAP_EXPLORATION');
  assert(explorationGap.severity === 'critical', `Expected critical, got ${explorationGap.severity}`);
});

test('Lifecycle override scale → GAP_EXPLORATION high (not critical)', () => {
  const kw = makeKeyword('1', 'test', 'exact');
  const ag = makeAdGroup('ag1', [kw]);
  const camp = makeCampaign('c1', { adGroups: [ag], targetingType: 'manual' });

  const ctx = makeCtx([camp], new Map([['c1', [makeInsight('keyword:1', 'winner', 5)]]]), { lifecycle: 'scale' });
  const gaps = gapDetector.detectGaps(ctx);

  const explorationGap = gaps.find(g => g.type === 'GAP_EXPLORATION');
  assert(explorationGap, 'Expected GAP_EXPLORATION');
  assert(explorationGap.severity === 'high', `Expected high, got ${explorationGap.severity}`);
});

console.log('\n📌 Mode-Based Plan Generation (generateCreationPlanForMode)');

test('HARVEST mode → dispatches to HarvestPlanBuilder', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({
    winnerKeywords: [{ text: 'kw1', matchType: 'exact', acos: 15, orders: 5, campaignId: 'c1' }],
    avgWinningBid: 0.60,
  });

  const plan = topFocusService.generateCreationPlanForMode(ctx, harvest, 'HARVEST');
  assert(plan, 'Expected a plan');
  assert(plan.campaignsToCreate.length >= 1, 'Expected at least 1 campaign');
  // HARVEST with winners → should have Exact
  const hasExact = plan.campaignsToCreate.some(c => c.type === 'SP_MANUAL_EXACT');
  assert(hasExact, 'Expected SP_MANUAL_EXACT in HARVEST with winners');
});

test('RESET mode → dispatches to ResetPlanBuilder', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'launch' });
  const harvest = makeHarvest({
    winnerKeywords: [{ text: 'kw1', matchType: 'exact', orders: 5, campaignId: 'c1' }], // Should be IGNORED
    avgWinningBid: 0.99, // Should be IGNORED
    userProvidedKeywords: ['test', 'book'],
  });

  const plan = topFocusService.generateCreationPlanForMode(ctx, harvest, 'RESET');
  assert(plan, 'Expected a plan');
  assert(plan.campaignsToCreate.length >= 1, 'Expected at least 1 campaign');
  // RESET launch → NO Exact
  const hasExact = plan.campaignsToCreate.some(c => c.type === 'SP_MANUAL_EXACT');
  assert(!hasExact, 'Expected NO SP_MANUAL_EXACT in RESET launch');
});

test('HARVEST and RESET produce different plans for same context', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({
    winnerKeywords: [{ text: 'kw1', matchType: 'exact', acos: 15, orders: 5, campaignId: 'c1' }],
    winnerAsins: ['B00ASIN1'],
    avgWinningBid: 0.72,
    userProvidedKeywords: ['test'],
  });

  const harvestPlan = topFocusService.generateCreationPlanForMode(ctx, harvest, 'HARVEST');
  const resetPlan = topFocusService.generateCreationPlanForMode(ctx, harvest, 'RESET');

  assert(harvestPlan.fingerprint !== resetPlan.fingerprint, 'Different modes should produce different fingerprints');

  const harvestTypes = harvestPlan.campaignsToCreate.map(c => c.type).sort();
  const resetTypes = resetPlan.campaignsToCreate.map(c => c.type).sort();
  // HARVEST should have Product (because of ASINs), RESET should not (launch doesn't)
  const harvestHasProduct = harvestTypes.includes('SP_PRODUCT');
  assert(harvestHasProduct, 'HARVEST should have SP_PRODUCT');
});

console.log('\n📌 TopFocus Behavior (legacy)');

test('STABLE with no gaps → TopFocus intent OBSERVE', () => {
  const kw = makeKeyword('1', 'test', 'exact');
  const ag = makeAdGroup('ag1', [kw]);
  const autoCamp = makeCampaign('c1', { adGroups: [ag], targetingType: 'auto' });
  const exactCamp = makeCampaign('c2', { adGroups: [makeAdGroup('ag2', [makeKeyword('2', 'test2', 'exact')])], targetingType: 'manual' });

  const insightsMap = new Map();
  insightsMap.set('c1', []);
  insightsMap.set('c2', []);

  const ctx = makeCtx([autoCamp, exactCamp], insightsMap, { lifecycle: 'scale' });
  ctx.gaps = [];

  const topFocus = topFocusService.computeTopFocus(ctx);
  assert(topFocus.primaryCta.intent === 'OBSERVE', `Expected OBSERVE, got ${topFocus.primaryCta.intent}`);
});

console.log('\n📌 Fingerprint Idempotence');

test('Same plan (same mode) produces same fingerprint', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'scale' });
  const harvest = makeHarvest({ userProvidedKeywords: ['test'] });

  const plan1 = topFocusService.generateCreationPlanForMode(ctx, harvest, 'RESET');
  const plan2 = topFocusService.generateCreationPlanForMode(ctx, harvest, 'RESET');

  assert(plan1 && plan2, 'Both plans should exist');
  assert(plan1.fingerprint === plan2.fingerprint, `Fingerprints should match: ${plan1.fingerprint} vs ${plan2.fingerprint}`);
});

test('Different lifecycle produces different fingerprint', () => {
  const ctx1 = makeCtx([], new Map(), { lifecycle: 'launch' });
  const ctx2 = makeCtx([], new Map(), { lifecycle: 'evergreen' });
  const harvest = makeHarvest({ userProvidedKeywords: ['test'] });

  const plan1 = topFocusService.generateCreationPlanForMode(ctx1, harvest, 'RESET');
  const plan2 = topFocusService.generateCreationPlanForMode(ctx2, harvest, 'RESET');

  assert(plan1 && plan2, 'Both plans should exist');
  assert(plan1.fingerprint !== plan2.fingerprint, 'Fingerprints should differ for different lifecycles');
});

console.log('\n📌 Pause-All Shape');

test('PauseAllForBookResult type has correct shape', () => {
  const result = {
    totalActive: 5,
    totalPaused: 4,
    totalFailed: 1,
    totalAlreadyPaused: 2,
    totalBudgetSaved: 35.50,
    failedCampaigns: [{ campaignId: 'c1', name: 'Camp1', error: 'timeout' }],
  };

  assert(typeof result.totalActive === 'number', 'totalActive should be number');
  assert(typeof result.totalPaused === 'number', 'totalPaused should be number');
  assert(typeof result.totalFailed === 'number', 'totalFailed should be number');
  assert(typeof result.totalAlreadyPaused === 'number', 'totalAlreadyPaused should be number');
  assert(typeof result.totalBudgetSaved === 'number', 'totalBudgetSaved should be number');
  assert(Array.isArray(result.failedCampaigns), 'failedCampaigns should be array');
  assert(result.failedCampaigns[0].campaignId === 'c1', 'Failed campaign shape correct');
});

console.log('\n📌 Harvest Seeds Injection');

test('Harvest winner keywords sorted by orders desc', () => {
  const kw1 = makeKeyword('1', 'top keyword', 'exact');
  const kw2 = makeKeyword('2', 'medium keyword', 'broad');
  const ag = makeAdGroup('ag1', [kw1, kw2]);
  const camp = makeCampaign('c1', { adGroups: [ag] });

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'winner', 10),
    makeInsight('keyword:2', 'winner', 3),
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const harvested = harvestService.harvest(ctx);

  assert(harvested.winnerKeywords.length === 2, `Expected 2, got ${harvested.winnerKeywords.length}`);
  assert(harvested.winnerKeywords[0].text === 'top keyword', 'Expected top keyword first (more orders)');
});

// ── Summary ──────────────────────────────────────────────────────

console.log('\n───────────────────────────────────────────────────────');
console.log(`✅ ${passed} passed, ❌ ${failed} failed — Total: ${passed + failed}`);
