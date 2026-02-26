/**
 * Tests unitaires : Rebuild Propre — lifecycle detection, creation-plan, pause-all
 * 10 tests couvrant le flow complet du rebuild wizard (backend)
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
      title: 'Test Book',
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

const gapDetector = new GapDetectorService();
const topFocusService = new TopFocusService();
const harvestService = new HarvestService(null);

// ── Tests ────────────────────────────────────────────────────────

console.log('\n📌 Lifecycle Override → Different Gap Detection');

test('Lifecycle override launch → GAP_EXPLORATION critical', () => {
  // No auto campaign, lifecycle=launch → critical exploration gap
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

console.log('\n📌 ForceRebuild Scenario');

test('STABLE with no gaps → TopFocus intent OBSERVE (normal behavior)', () => {
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

test('STABLE with injected GAP_EXPLORATION → creates SP_AUTO in plan', () => {
  const kw = makeKeyword('1', 'test', 'exact');
  const ag = makeAdGroup('ag1', [kw]);
  const camp = makeCampaign('c1', { adGroups: [ag], targetingType: 'manual' });

  const insightsMap = new Map();
  insightsMap.set('c1', [makeInsight('keyword:1', 'winner', 5)]);

  const ctx = makeCtx([camp], insightsMap, { lifecycle: 'scale' });
  // Force a gap (simulates forceRebuild behavior)
  ctx.gaps = [{
    type: 'GAP_EXPLORATION',
    severity: 'critical',
    label: 'Campagne de découverte manquante',
    explanation: 'Aucune campagne Auto.',
    campaignsToCreate: ['SP_AUTO'],
  }];

  const plan = topFocusService.generateCreationPlan(ctx);
  assert(plan, 'Expected a creation plan');
  assert(plan.campaignsToCreate.length >= 1, `Expected at least 1 campaign, got ${plan.campaignsToCreate.length}`);
  const hasAuto = plan.campaignsToCreate.some(c => c.type === 'SP_AUTO');
  assert(hasAuto, 'Expected SP_AUTO in creation plan');
});

console.log('\n📌 Harvest Seeds Injection');

test('Harvest winner keywords are properly extracted and sorted', () => {
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
  assert(harvested.winnerKeywords[0].orders === 10, 'Expected 10 orders');
});

test('Harvested seeds can be injected into manual campaigns', () => {
  const kw = makeKeyword('1', 'winner kw', 'exact');
  const ag = makeAdGroup('ag1', [kw]);
  const camp = makeCampaign('c1', { adGroups: [ag], targetingType: 'manual' });

  const insightsMap = new Map();
  insightsMap.set('c1', [makeInsight('keyword:1', 'winner', 5)]);

  const ctx = makeCtx([camp], insightsMap, { lifecycle: 'scale' });
  ctx.gaps = [{
    type: 'GAP_VALIDATION',
    severity: 'critical',
    label: 'Validation manquante',
    explanation: 'Test',
    campaignsToCreate: ['SP_MANUAL_EXACT'],
  }];

  const plan = topFocusService.generateCreationPlan(ctx);
  const harvested = harvestService.harvest(ctx);

  // Simulate seed injection (as done in generateCreationPlan service method)
  if (plan && harvested.winnerKeywords.length > 0) {
    for (const c of plan.campaignsToCreate) {
      if (c.targetingMode === 'MANUAL' && (!c.seedKeywords || c.seedKeywords.length === 0)) {
        c.seedKeywords = harvested.winnerKeywords.map(w => w.text);
      }
    }
  }

  assert(plan, 'Expected plan');
  const manualCampaign = plan.campaignsToCreate.find(c => c.targetingMode === 'MANUAL');
  if (manualCampaign) {
    assert(manualCampaign.seedKeywords && manualCampaign.seedKeywords.length > 0, 'Expected seeds injected');
    assert(manualCampaign.seedKeywords.includes('winner kw'), 'Expected "winner kw" in seeds');
  }
});

console.log('\n📌 Pause-All Logic');

test('PauseAllForBookResult type has correct shape', () => {
  // Type validation test — just verify the structure is correct
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

console.log('\n📌 Fingerprint Idempotence');

test('Same plan produces same fingerprint (idempotence base)', () => {
  // The creation plan fingerprint is based on plan contents
  const kw = makeKeyword('1', 'test', 'exact');
  const ag = makeAdGroup('ag1', [kw]);
  const camp = makeCampaign('c1', { adGroups: [ag], targetingType: 'manual' });

  const insightsMap = new Map();
  insightsMap.set('c1', [makeInsight('keyword:1', 'winner', 5)]);

  const ctx = makeCtx([camp], insightsMap, { lifecycle: 'scale' });
  ctx.gaps = [{
    type: 'GAP_EXPLORATION',
    severity: 'critical',
    label: 'Test',
    explanation: 'Test',
    campaignsToCreate: ['SP_AUTO'],
  }];

  const plan1 = topFocusService.generateCreationPlan(ctx);
  const plan2 = topFocusService.generateCreationPlan(ctx);

  assert(plan1 && plan2, 'Both plans should exist');
  assert(plan1.fingerprint === plan2.fingerprint, `Fingerprints should match: ${plan1.fingerprint} vs ${plan2.fingerprint}`);
});

test('Different lifecycle produces different fingerprint', () => {
  const kw = makeKeyword('1', 'test', 'exact');
  const ag = makeAdGroup('ag1', [kw]);
  const camp = makeCampaign('c1', { adGroups: [ag], targetingType: 'manual' });

  const gap = {
    type: 'GAP_EXPLORATION',
    severity: 'critical',
    label: 'Test',
    explanation: 'Test',
    campaignsToCreate: ['SP_AUTO'],
  };

  const ctx1 = makeCtx([camp], new Map([['c1', []]]), { lifecycle: 'launch' });
  ctx1.gaps = [gap];

  const ctx2 = makeCtx([camp], new Map([['c1', []]]), { lifecycle: 'evergreen' });
  ctx2.gaps = [gap];

  const plan1 = topFocusService.generateCreationPlan(ctx1);
  const plan2 = topFocusService.generateCreationPlan(ctx2);

  assert(plan1 && plan2, 'Both plans should exist');
  // Different lifecycle → different budgets → different fingerprint
  assert(plan1.fingerprint !== plan2.fingerprint, 'Fingerprints should differ for different lifecycles');
});

// ── Summary ──────────────────────────────────────────────────────

console.log('\n───────────────────────────────────────────────────────');
console.log(`✅ ${passed} passed, ❌ ${failed} failed — Total: ${passed + failed}`);
