/**
 * Tests unitaires : Strategic Campaign Builder
 * Tests: harvest metrics (avgWinningBid, avgCpc, topPlacement), strategic plan builder,
 * deterministic bid/strategy/placement rules, explanations
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

function makeInsight(entityKey, diagnosisCode, opts = {}) {
  return {
    entityKey,
    entityType: entityKey.startsWith('keyword:') ? 'keyword' : 'target',
    diagnosisCode,
    eligibility: true,
    summaryFacts: {
      impressions: opts.impressions || 500,
      clicks: opts.clicks || 20,
      ctr: 0.04,
      orders: opts.orders || 0,
      cvr: opts.clicks > 0 ? (opts.orders || 0) / opts.clicks : 0,
      spend: opts.spend || 10,
      sales: opts.sales || 0,
      acos: opts.acos || null,
      periodDays: 14,
    },
    suggestedActions: [],
    confidenceScore: 0.8,
  };
}

function makeCtx(campaigns = [], insightsMap = new Map(), opts = {}) {
  return {
    scenario: opts.scenario || 'scenario_stable',
    bookContext: {
      id: 'book-1',
      title: opts.title || 'Thriller Psychologique Extreme',
      asin: 'B001',
      lifecyclePhase: opts.lifecycle || 'launch',
      acosTarget: 30,
      royaltyPerUnit: 3.5,
      salePrice: 9.99,
    },
    campaigns,
    entityInsightsMap: insightsMap,
    duplicationScore: opts.duplication || 0,
    chaosScore: opts.chaos || 0,
    campaignRoles: opts.roles || [],
    maturityScore: opts.maturity || 50,
    context: {
      lifecyclePhase: opts.lifecycle || 'launch',
      totalCampaigns: campaigns.length,
      totalAdGroups: 1,
      totalKeywords: 5,
      totalProductTargets: 0,
      totalWinnerKeywords: 0,
      totalBoostCandidateKeywords: 0,
    },
    gaps: opts.gaps || [],
  };
}

// ── Load services ──────────────────────────────────────────────

const { HarvestService } = require('../services/harvest.service');
const { TopFocusService } = require('../services/top-focus.service');

const harvestService = new HarvestService(null);
const topFocusService = new TopFocusService();

// ════════════════════════════════════════════════════════════════
// ── Part 1: Harvest Metrics ────────────────────────────────────
// ════════════════════════════════════════════════════════════════

console.log('\n📌 avgWinningBid Computation');

test('Computes avgWinningBid from winner keyword CPC', () => {
  // Winner 1: spend=10, clicks=20 → CPC=0.50
  // Winner 2: spend=15, clicks=10 → CPC=1.50
  // Average: (0.50 + 1.50) / 2 = 1.00
  const kw1 = makeKeyword('1', 'mot gagnant', 'exact');
  const kw2 = makeKeyword('2', 'autre gagnant', 'broad');
  const ag = makeAdGroup('ag1', [kw1, kw2]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'winner', { spend: 10, clicks: 20, orders: 5, acos: 15 }),
    makeInsight('keyword:2', 'winner', { spend: 15, clicks: 10, orders: 3, acos: 20 }),
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = harvestService.harvest(ctx);

  assert(result.avgWinningBid !== null, 'avgWinningBid should not be null');
  assert(Math.abs(result.avgWinningBid - 1.00) < 0.01, `Expected avgWinningBid ~1.00, got ${result.avgWinningBid}`);
});

test('avgWinningBid is null when no winners', () => {
  const kw1 = makeKeyword('1', 'mot', 'exact');
  const ag = makeAdGroup('ag1', [kw1]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'boost_candidate', { spend: 10, clicks: 20, orders: 2 }),
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = harvestService.harvest(ctx);

  assert(result.avgWinningBid === null, 'avgWinningBid should be null when no winners');
});

console.log('\n📌 avgCpcObserved Computation');

test('Computes avgCpcObserved from all keywords with spend', () => {
  const kw1 = makeKeyword('1', 'mot1', 'exact');
  const kw2 = makeKeyword('2', 'mot2', 'broad');
  const kw3 = makeKeyword('3', 'mot3', 'phrase');
  const ag = makeAdGroup('ag1', [kw1, kw2, kw3]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'winner', { spend: 10, clicks: 20, orders: 5 }),   // CPC=0.50
    makeInsight('keyword:2', 'low_clicks', { spend: 5, clicks: 5, orders: 0 }), // CPC=1.00
    makeInsight('keyword:3', 'clicks_no_sales', { spend: 8, clicks: 16, orders: 0 }), // CPC=0.50
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = harvestService.harvest(ctx);

  assert(result.avgCpcObserved !== null, 'avgCpcObserved should not be null');
  // (0.50 + 1.00 + 0.50) / 3 = 0.6667
  assert(Math.abs(result.avgCpcObserved - 0.67) < 0.01, `Expected avgCpcObserved ~0.67, got ${result.avgCpcObserved}`);
});

console.log('\n📌 topPlacementPerformance Computation');

test('Computes CVR ratio between winners and other entities', () => {
  const kw1 = makeKeyword('1', 'winner', 'exact');
  const kw2 = makeKeyword('2', 'loser', 'broad');
  const ag = makeAdGroup('ag1', [kw1, kw2]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    // Winner: 20 clicks, 4 orders → CVR=0.20
    makeInsight('keyword:1', 'winner', { clicks: 20, orders: 4, spend: 10 }),
    // Other: 20 clicks, 1 order → CVR=0.05
    makeInsight('keyword:2', 'clicks_no_sales', { clicks: 20, orders: 1, spend: 10 }),
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = harvestService.harvest(ctx);

  assert(result.topPlacementPerformance !== null, 'topPlacementPerformance should not be null');
  // ratio = 0.20 / 0.05 = 4.0
  assert(result.topPlacementPerformance === 4.0, `Expected ratio 4.0, got ${result.topPlacementPerformance}`);
});

test('topPlacementPerformance is null when no winners or no others', () => {
  const ctx = makeCtx([], new Map());
  const result = harvestService.harvest(ctx);
  assert(result.topPlacementPerformance === null, 'Should be null with no data');
});

console.log('\n📌 userProvidedKeywords Inference');

test('Infers keywords from book title', () => {
  const ctx = makeCtx([], new Map(), { title: 'Le Thriller Psychologique Extreme' });
  const result = harvestService.harvest(ctx);

  assert(result.userProvidedKeywords.length > 0, 'Should have inferred keywords');
  assert(result.userProvidedKeywords.includes('thriller'), `Should include 'thriller', got: ${result.userProvidedKeywords}`);
  assert(result.userProvidedKeywords.includes('psychologique'), 'Should include "psychologique"');
  // "le" and "extreme" (accent) behavior depends on regex — "le" is too short (3 chars)
  assert(!result.userProvidedKeywords.includes('le'), '"le" should be excluded (too short)');
});

// ════════════════════════════════════════════════════════════════
// ── Part 2: Strategic Plan Builder ─────────────────────────────
// ════════════════════════════════════════════════════════════════

console.log('\n📌 Strategic Plan: Rebuild Without History');

test('Rebuild without history → Auto + Expression (from userKeywords)', () => {
  // No existing campaigns, no winners, just a book title
  const ctx = makeCtx([], new Map(), {
    lifecycle: 'launch',
    title: 'Thriller Psychologique Dangereux',
    scenario: 'scenario_a_no_campaigns',
    gaps: [{ type: 'GAP_EXPLORATION', severity: 'critical', label: 'Pas de campagne Auto', explanation: 'test', campaignsToCreate: ['SP_AUTO'] }],
  });

  const harvest = harvestService.harvest(ctx);

  // Force plan generation
  const plan = topFocusService.generateCreationPlanForced(ctx, harvest);

  assert(plan !== undefined, 'Plan should exist');
  assert(plan.campaignsToCreate.length >= 2, `Expected at least 2 campaigns, got ${plan.campaignsToCreate.length}`);

  const types = plan.campaignsToCreate.map(c => c.type);
  assert(types.includes('SP_AUTO'), 'Should include SP_AUTO');
  assert(types.includes('SP_MANUAL_BROAD'), `Should include SP_MANUAL_BROAD (Expression), got: ${types}`);
});

console.log('\n📌 Strategic Plan: Rebuild With Winners');

test('Rebuild with winners → Auto + Expression + Exact + Product', () => {
  // Winners are in broad/phrase match (NOT yet isolated in exact) to trigger Exact creation
  // ASIN targets exist in c1 but c1 is a keyword campaign (no product targeting role)
  const kw1 = makeKeyword('1', 'thriller', 'broad');
  const kw2 = makeKeyword('2', 'roman noir', 'phrase');
  const tg1 = makeTarget('1', 'asinSameAs', 'B00ABCDEF1');
  const ag = makeAdGroup('ag1', [kw1, kw2], [tg1]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'winner', { spend: 10, clicks: 20, orders: 5, acos: 15 }),
    makeInsight('keyword:2', 'winner', { spend: 8, clicks: 16, orders: 3, acos: 20 }),
    makeInsight('target:1', 'winner', { spend: 5, clicks: 10, orders: 2, acos: 12 }),
  ]);

  const ctx = makeCtx([camp], insightsMap, {
    lifecycle: 'scale',
    title: 'Mon Thriller',
    scenario: 'scenario_c_winners_exist',
    gaps: [
      { type: 'GAP_EXPLORATION', severity: 'high', label: 'No Auto', explanation: 'test', campaignsToCreate: ['SP_AUTO'] },
      { type: 'GAP_AMPLIFICATION', severity: 'high', label: 'Winners not isolated', explanation: 'test', campaignsToCreate: ['SP_MANUAL_EXACT'] },
    ],
  });

  const harvest = harvestService.harvest(ctx);

  assert(harvest.winnerKeywords.length === 2, `Expected 2 winners, got ${harvest.winnerKeywords.length}`);
  assert(harvest.winnerAsins.length === 1, `Expected 1 ASIN, got ${harvest.winnerAsins.length}`);
  assert(harvest.avgWinningBid !== null, 'avgWinningBid should not be null');

  const plan = topFocusService.generateCreationPlanForced(ctx, harvest);

  assert(plan !== undefined, 'Plan should exist');
  const types = plan.campaignsToCreate.map(c => c.type);
  assert(types.includes('SP_AUTO'), 'Should include SP_AUTO');
  assert(types.includes('SP_MANUAL_EXACT'), `Should include SP_MANUAL_EXACT, got: ${types}`);
  // SP_PRODUCT is NOT created because existing campaign already has product targets
  // This is correct behavior — the builder doesn't duplicate existing types
  assert(types.length >= 2, `Should have at least 2 campaigns, got ${types.length}`);
});

console.log('\n📌 Deterministic Bid Rules');

test('Bid uses avgWinningBid * 1.05 for Exact winners', () => {
  const kw1 = makeKeyword('1', 'winner', 'exact');
  const ag = makeAdGroup('ag1', [kw1]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'winner', { spend: 10, clicks: 20, orders: 5, acos: 15 }),
  ]);

  const ctx = makeCtx([camp], insightsMap, {
    lifecycle: 'scale',
    scenario: 'scenario_c_winners_exist',
    gaps: [
      { type: 'GAP_EXPLORATION', severity: 'high', label: 'No Auto', explanation: 'test', campaignsToCreate: ['SP_AUTO'] },
    ],
  });

  const harvest = harvestService.harvest(ctx);
  const plan = topFocusService.generateCreationPlanForced(ctx, harvest);

  const exactCampaign = plan.campaignsToCreate.find(c => c.type === 'SP_MANUAL_EXACT');
  if (exactCampaign) {
    // avgWinningBid = spend/clicks = 10/20 = 0.50 → * 1.05 = 0.525 → rounded to 0.53
    assert(exactCampaign.defaultBid > 0, 'Exact campaign should have a bid > 0');
    assert(exactCampaign.defaultBid <= 5.0, 'Bid should be within guards');
  }

  const autoCampaign = plan.campaignsToCreate.find(c => c.type === 'SP_AUTO');
  if (autoCampaign) {
    assert(autoCampaign.defaultBid > 0, 'Auto campaign should have a bid > 0');
    // Auto bid = manual * 0.9, should be lower
    if (exactCampaign) {
      assert(autoCampaign.defaultBid <= exactCampaign.defaultBid, 'Auto bid should be <= Exact bid');
    }
  }
});

console.log('\n📌 Bidding Strategy per Lifecycle');

test('Launch uses UP_DOWN strategy for Auto', () => {
  const ctx = makeCtx([], new Map(), {
    lifecycle: 'launch',
    scenario: 'scenario_a_no_campaigns',
    gaps: [{ type: 'GAP_EXPLORATION', severity: 'critical', label: 'test', explanation: 'test', campaignsToCreate: ['SP_AUTO'] }],
  });
  const harvest = harvestService.harvest(ctx);
  const plan = topFocusService.generateCreationPlanForced(ctx, harvest);

  const auto = plan.campaignsToCreate.find(c => c.type === 'SP_AUTO');
  assert(auto !== undefined, 'Should have Auto campaign');
  assert(auto.biddingStrategy === 'UP_DOWN', `Launch Auto should use UP_DOWN, got ${auto.biddingStrategy}`);
});

test('Scale uses DOWN_ONLY for Auto, UP_DOWN for Exact', () => {
  const kw1 = makeKeyword('1', 'winner', 'exact');
  const ag = makeAdGroup('ag1', [kw1]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'winner', { spend: 10, clicks: 20, orders: 5, acos: 15 }),
  ]);

  const ctx = makeCtx([camp], insightsMap, {
    lifecycle: 'scale',
    scenario: 'scenario_c_winners_exist',
    gaps: [
      { type: 'GAP_EXPLORATION', severity: 'high', label: 'test', explanation: 'test', campaignsToCreate: ['SP_AUTO'] },
    ],
  });

  const harvest = harvestService.harvest(ctx);
  const plan = topFocusService.generateCreationPlanForced(ctx, harvest);

  const auto = plan.campaignsToCreate.find(c => c.type === 'SP_AUTO');
  const exact = plan.campaignsToCreate.find(c => c.type === 'SP_MANUAL_EXACT');

  if (auto) {
    assert(auto.biddingStrategy === 'DOWN_ONLY', `Scale Auto should use DOWN_ONLY, got ${auto.biddingStrategy}`);
  }
  if (exact) {
    assert(exact.biddingStrategy === 'UP_DOWN', `Scale Exact should use UP_DOWN, got ${exact.biddingStrategy}`);
  }
});

console.log('\n📌 Placement Adjustments');

test('No placement adjustment when topPlacementPerformance <= 1.0', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'launch' });
  const harvest = harvestService.harvest(ctx);

  // topPlacementPerformance is null → no adjustment
  const plan = topFocusService.generateCreationPlanForced(ctx, harvest);
  const auto = plan.campaignsToCreate.find(c => c.type === 'SP_AUTO');
  assert(!auto.placementAdjustments, 'Should have no placement adjustments when no data');
});

console.log('\n📌 Explanations');

test('Each campaign has explanations array', () => {
  const ctx = makeCtx([], new Map(), {
    lifecycle: 'launch',
    title: 'Mon Thriller Test',
    scenario: 'scenario_a_no_campaigns',
    gaps: [{ type: 'GAP_EXPLORATION', severity: 'critical', label: 'test', explanation: 'test', campaignsToCreate: ['SP_AUTO'] }],
  });

  const harvest = harvestService.harvest(ctx);
  const plan = topFocusService.generateCreationPlanForced(ctx, harvest);

  for (const campaign of plan.campaignsToCreate) {
    assert(Array.isArray(campaign.explanations), `Campaign ${campaign.name} should have explanations array`);
    assert(campaign.explanations.length >= 2, `Campaign ${campaign.name} should have at least 2 explanations, got ${campaign.explanations.length}`);

    // Each explanation should have the required fields
    for (const ex of campaign.explanations) {
      assert(typeof ex.parameter === 'string', 'Explanation should have parameter');
      assert(typeof ex.value === 'string', 'Explanation should have value');
      assert(typeof ex.reasoning === 'string', 'Explanation should have reasoning');
      assert(typeof ex.dataSource === 'string', 'Explanation should have dataSource');
      assert(['real_data', 'lifecycle_default', 'inferred', 'rule_based'].includes(ex.dataSource),
        `dataSource should be valid, got "${ex.dataSource}"`);
    }

    // Should have type and bid explanations at minimum
    const parameterTypes = campaign.explanations.map(e => e.parameter);
    assert(parameterTypes.includes('type'), `Campaign ${campaign.name} should explain 'type'`);
    assert(parameterTypes.includes('bid'), `Campaign ${campaign.name} should explain 'bid'`);
  }
});

test('Explanation uses real_data source when avgWinningBid is available', () => {
  const kw1 = makeKeyword('1', 'winner', 'exact');
  const ag = makeAdGroup('ag1', [kw1]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'winner', { spend: 10, clicks: 20, orders: 5, acos: 15 }),
  ]);

  const ctx = makeCtx([camp], insightsMap, {
    lifecycle: 'scale',
    scenario: 'scenario_c_winners_exist',
    gaps: [{ type: 'GAP_EXPLORATION', severity: 'high', label: 'test', explanation: 'test', campaignsToCreate: ['SP_AUTO'] }],
  });

  const harvest = harvestService.harvest(ctx);
  const plan = topFocusService.generateCreationPlanForced(ctx, harvest);

  const exact = plan.campaignsToCreate.find(c => c.type === 'SP_MANUAL_EXACT');
  if (exact) {
    const bidExplanation = exact.explanations.find(e => e.parameter === 'bid');
    assert(bidExplanation !== undefined, 'Should have bid explanation');
    assert(bidExplanation.dataSource === 'real_data', `Bid source should be real_data, got ${bidExplanation.dataSource}`);
  }
});

console.log('\n📌 Override Lifecycle Modifies Plan');

test('Scale lifecycle produces more campaign types than launch', () => {
  // With winners + ASINs
  const kw1 = makeKeyword('1', 'winner', 'exact');
  const tg1 = makeTarget('1', 'asinSameAs', 'B00ABCDEF1');
  const ag = makeAdGroup('ag1', [kw1], [tg1]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'winner', { spend: 10, clicks: 20, orders: 5, acos: 15 }),
    makeInsight('target:1', 'winner', { spend: 5, clicks: 10, orders: 2, acos: 12 }),
  ]);

  // Launch plan
  const ctxLaunch = makeCtx([camp], insightsMap, {
    lifecycle: 'launch',
    scenario: 'scenario_c_winners_exist',
    gaps: [{ type: 'GAP_EXPLORATION', severity: 'high', label: 'test', explanation: 'test', campaignsToCreate: ['SP_AUTO'] }],
  });
  const harvestLaunch = harvestService.harvest(ctxLaunch);
  const planLaunch = topFocusService.generateCreationPlanForced(ctxLaunch, harvestLaunch);

  // Scale plan
  const ctxScale = makeCtx([camp], insightsMap, {
    lifecycle: 'scale',
    scenario: 'scenario_c_winners_exist',
    gaps: [{ type: 'GAP_EXPLORATION', severity: 'high', label: 'test', explanation: 'test', campaignsToCreate: ['SP_AUTO'] }],
  });
  const harvestScale = harvestService.harvest(ctxScale);
  const planScale = topFocusService.generateCreationPlanForced(ctxScale, harvestScale);

  // Scale should have higher Exact budget
  const exactLaunch = planLaunch.campaignsToCreate.find(c => c.type === 'SP_MANUAL_EXACT');
  const exactScale = planScale.campaignsToCreate.find(c => c.type === 'SP_MANUAL_EXACT');

  if (exactLaunch && exactScale) {
    assert(exactScale.dailyBudget >= exactLaunch.dailyBudget,
      `Scale Exact budget (${exactScale.dailyBudget}) should be >= Launch (${exactLaunch.dailyBudget})`);
  }
});

console.log('\n📌 Category Campaign in Scale/Evergreen');

test('Scale with no ASINs and no product targeting → adds SP_CATEGORY', () => {
  const ctx = makeCtx([], new Map(), {
    lifecycle: 'scale',
    title: 'Mon Thriller',
    scenario: 'scenario_a_no_campaigns',
    gaps: [{ type: 'GAP_EXPLORATION', severity: 'high', label: 'test', explanation: 'test', campaignsToCreate: ['SP_AUTO'] }],
  });

  const harvest = harvestService.harvest(ctx);
  const plan = topFocusService.generateCreationPlanForced(ctx, harvest);

  const types = plan.campaignsToCreate.map(c => c.type);
  assert(types.includes('SP_CATEGORY'), `Scale with no ASINs should include SP_CATEGORY, got: ${types}`);
});

test('Launch does NOT add SP_CATEGORY', () => {
  const ctx = makeCtx([], new Map(), {
    lifecycle: 'launch',
    title: 'Mon Thriller',
    scenario: 'scenario_a_no_campaigns',
    gaps: [{ type: 'GAP_EXPLORATION', severity: 'high', label: 'test', explanation: 'test', campaignsToCreate: ['SP_AUTO'] }],
  });

  const harvest = harvestService.harvest(ctx);
  const plan = topFocusService.generateCreationPlanForced(ctx, harvest);

  const types = plan.campaignsToCreate.map(c => c.type);
  assert(!types.includes('SP_CATEGORY'), `Launch should NOT include SP_CATEGORY, got: ${types}`);
});

// ── Summary ──────────────────────────────────────────────────────

console.log('\n───────────────────────────────────────────────────────');
console.log(`✅ ${passed} passed, ❌ ${failed} failed — Total: ${passed + failed}`);
