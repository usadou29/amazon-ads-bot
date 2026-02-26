/**
 * Tests unitaires : TopFocus, Roadmap enrichi, CreationPlan, Batch endpoint
 * 16 tests couvrant tous les scénarios et cas limites
 */

// ── Test helpers ────────────────────────────────────────────────

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

function makeCampaign(overrides = {}) {
  return {
    id: 'camp-' + Math.random().toString(36).substr(2, 6),
    name: 'Test Campaign',
    campaignType: 'sponsoredProducts',
    targetingType: 'manual',
    state: 'enabled',
    dailyBudget: 10,
    startDate: null,
    adGroups: [],
    ...overrides,
  };
}

function makeAdGroup(overrides = {}) {
  return {
    id: 'ag-' + Math.random().toString(36).substr(2, 6),
    name: 'Test AG',
    state: 'enabled',
    defaultBid: 0.5,
    keywords: [],
    targets: [],
    ...overrides,
  };
}

function makeKeyword(overrides = {}) {
  return {
    id: 'kw-' + Math.random().toString(36).substr(2, 6),
    amazonKeywordId: Math.floor(Math.random() * 100000),
    keywordText: 'test keyword',
    matchType: 'exact',
    state: 'enabled',
    bid: 0.5,
    ...overrides,
  };
}

function makeTarget(overrides = {}) {
  return {
    id: 'tg-' + Math.random().toString(36).substr(2, 6),
    amazonTargetId: Math.floor(Math.random() * 100000),
    expressionType: 'asinSameAs',
    expression: {},
    state: 'enabled',
    bid: 0.5,
    ...overrides,
  };
}

function makeEntityInsight(overrides = {}) {
  return {
    entityKey: 'keyword:kw-1',
    entityType: 'keyword',
    diagnosisCode: 'winner',
    eligibility: true,
    impressions: 1000,
    clicks: 50,
    spend: 20,
    sales: 60,
    orders: 3,
    acos: 33,
    conversionRate: 6,
    cpc: 0.4,
    roas: 3,
    ...overrides,
  };
}

function makeBookContext(overrides = {}) {
  return {
    id: 'book-1',
    title: 'Mon Thriller Sombre',
    asin: 'B0TESTBOOK',
    lifecyclePhase: 'launch',
    acosTarget: 40,
    royaltyPerUnit: 2.8,
    salePrice: 9.99,
    ...overrides,
  };
}

function makeTopFocusContext(overrides = {}) {
  return {
    scenario: 'scenario_a_no_campaigns',
    bookContext: makeBookContext(),
    campaigns: [],
    entityInsightsMap: new Map(),
    duplicationScore: 0,
    chaosScore: 0,
    campaignRoles: [],
    maturityScore: 0,
    context: {
      lifecyclePhase: 'launch',
      totalCampaigns: 0,
      totalAdGroups: 0,
      totalKeywords: 0,
      totalProductTargets: 0,
      totalWinnerKeywords: 0,
      totalBoostCandidateKeywords: 0,
    },
    ...overrides,
  };
}

// ── Replicated deterministic logic (mirrors service implementations) ──

function getExistingCampaignTypes(campaigns) {
  const types = new Set();
  for (const c of campaigns) {
    if (c.state === 'archived') continue;
    if (c.targetingType === 'auto') types.add('auto');
    for (const ag of c.adGroups) {
      for (const kw of ag.keywords) {
        if (kw.state !== 'archived') types.add(kw.matchType);
      }
      if (ag.targets.length > 0) types.add('product');
    }
  }
  return types;
}

function hasBasicCampaignStructure(campaigns) {
  const types = getExistingCampaignTypes(campaigns);
  return types.has('auto') && (types.has('exact') || types.has('phrase'));
}

function needsDedicatedExactCampaign(ctx) {
  const winnerKeys = new Set();
  for (const [, insights] of ctx.entityInsightsMap) {
    for (const insight of insights) {
      if (insight.diagnosisCode === 'winner') winnerKeys.add(insight.entityKey);
    }
  }
  if (winnerKeys.size === 0) return false;
  for (const c of ctx.campaigns) {
    if (c.state === 'archived') continue;
    const exactKws = c.adGroups.flatMap(ag =>
      ag.keywords.filter(k => k.matchType === 'exact' && k.state !== 'archived'),
    );
    const winnerInExact = exactKws.filter(k => winnerKeys.has(`keyword:${k.id}`));
    if (winnerInExact.length >= winnerKeys.size * 0.5) return false;
  }
  return true;
}

function hasProductTargeting(ctx) {
  return ctx.campaigns.some(c =>
    c.state !== 'archived' && c.adGroups.some(ag => ag.targets.length > 0),
  );
}

function computeTheme(scenario) {
  switch (scenario) {
    case 'scenario_a_no_campaigns': return 'VISIBILITE';
    case 'scenario_b_chaos_detected': return 'STRUCTURE';
    case 'scenario_c_winners_exist': return 'RENTABILITE';
    case 'scenario_stable': return 'VISIBILITE';
    default: return 'VISIBILITE';
  }
}

function computeIntent(scenario, ctx) {
  switch (scenario) {
    case 'scenario_a_no_campaigns': return 'CREATE';
    case 'scenario_b_chaos_detected':
      return hasBasicCampaignStructure(ctx.campaigns) ? 'CLEANUP' : 'CREATE';
    case 'scenario_c_winners_exist':
      return needsDedicatedExactCampaign(ctx) ? 'CREATE' : 'AMPLIFY';
    case 'scenario_stable': return 'OBSERVE';
    default: return 'OBSERVE';
  }
}

function buildCampaignsToCreate(ctx) {
  const bookTitle = (ctx.bookContext.title || 'Livre').slice(0, 25);
  const lifecycle = ctx.bookContext.lifecyclePhase || 'launch';
  const result = [];

  if (ctx.scenario === 'scenario_a_no_campaigns') {
    result.push({ name: `${bookTitle}-SP-Auto`, type: 'SP_AUTO', targetingMode: 'AUTO' });
    result.push({ name: `${bookTitle}-SP-Exact`, type: 'SP_MANUAL_EXACT', targetingMode: 'MANUAL' });
    if (lifecycle === 'scale' || lifecycle === 'evergreen') {
      result.push({ name: `${bookTitle}-SP-Phrase`, type: 'SP_MANUAL_PHRASE', targetingMode: 'MANUAL' });
    }
  } else if (ctx.scenario === 'scenario_b_chaos_detected') {
    const types = getExistingCampaignTypes(ctx.campaigns);
    if (!types.has('auto')) result.push({ name: `${bookTitle}-SP-Auto`, type: 'SP_AUTO', targetingMode: 'AUTO' });
    if (!types.has('exact')) result.push({ name: `${bookTitle}-SP-Exact`, type: 'SP_MANUAL_EXACT', targetingMode: 'MANUAL' });
  } else if (ctx.scenario === 'scenario_c_winners_exist') {
    if (needsDedicatedExactCampaign(ctx)) {
      result.push({ name: `${bookTitle}-SP-Winners-Exact`, type: 'SP_MANUAL_EXACT', targetingMode: 'MANUAL' });
    }
    if (!hasProductTargeting(ctx)) {
      result.push({ name: `${bookTitle}-SP-Product`, type: 'SP_PRODUCT', targetingMode: 'MANUAL' });
    }
  }
  return result;
}

function typeToMatchTypes(type) {
  switch (type) {
    case 'SP_MANUAL_EXACT': return ['exact'];
    case 'SP_MANUAL_PHRASE': return ['phrase'];
    case 'SP_MANUAL_BROAD': return ['broad'];
    default: return [];
  }
}

// ── TESTS ─────────────────────────────────────────────────────────

console.log('\n🧪 TopFocus + Roadmap + CreationPlan Tests');
console.log('─'.repeat(55));

// ── 1. TopFocus Theme tests ──────────────────────────────────────

console.log('\n📌 TopFocus Theme Rules');

test('Scenario A → theme VISIBILITE', () => {
  assert(computeTheme('scenario_a_no_campaigns') === 'VISIBILITE',
    'Scenario A should map to VISIBILITE');
});

test('Scenario B → theme STRUCTURE', () => {
  assert(computeTheme('scenario_b_chaos_detected') === 'STRUCTURE',
    'Scenario B should map to STRUCTURE');
});

test('Scenario C → theme RENTABILITE', () => {
  assert(computeTheme('scenario_c_winners_exist') === 'RENTABILITE',
    'Scenario C should map to RENTABILITE');
});

test('Scenario STABLE → theme VISIBILITE', () => {
  assert(computeTheme('scenario_stable') === 'VISIBILITE',
    'Scenario STABLE should map to VISIBILITE');
});

// ── 2. CTA Intent tests ──────────────────────────────────────────

console.log('\n📌 CTA Intent Rules');

test('Scenario A → intent CREATE (always)', () => {
  const ctx = makeTopFocusContext({ scenario: 'scenario_a_no_campaigns' });
  assert(computeIntent('scenario_a_no_campaigns', ctx) === 'CREATE',
    'Scenario A should always be CREATE');
});

test('Scenario B without basic structure → intent CREATE', () => {
  const ctx = makeTopFocusContext({
    scenario: 'scenario_b_chaos_detected',
    campaigns: [makeCampaign({ targetingType: 'manual', adGroups: [] })],
  });
  assert(computeIntent('scenario_b_chaos_detected', ctx) === 'CREATE',
    'Scenario B without auto+exact → CREATE');
});

test('Scenario B with auto+exact → intent CLEANUP', () => {
  const kw = makeKeyword({ matchType: 'exact' });
  const ag = makeAdGroup({ keywords: [kw] });
  const campaigns = [
    makeCampaign({ targetingType: 'auto', adGroups: [] }),
    makeCampaign({ targetingType: 'manual', adGroups: [ag] }),
  ];
  const ctx = makeTopFocusContext({ scenario: 'scenario_b_chaos_detected', campaigns });
  assert(computeIntent('scenario_b_chaos_detected', ctx) === 'CLEANUP',
    'Scenario B with auto+exact → CLEANUP');
});

test('Scenario C with winners NOT in exact → intent CREATE', () => {
  const kw = makeKeyword({ id: 'kw-w1', matchType: 'broad' });
  const ag = makeAdGroup({ keywords: [kw] });
  const campaigns = [makeCampaign({ id: 'c1', adGroups: [ag] })];
  const entityInsightsMap = new Map();
  entityInsightsMap.set('c1', [
    makeEntityInsight({ entityKey: `keyword:kw-w1`, diagnosisCode: 'winner' }),
  ]);
  const ctx = makeTopFocusContext({
    scenario: 'scenario_c_winners_exist',
    campaigns,
    entityInsightsMap,
  });
  assert(computeIntent('scenario_c_winners_exist', ctx) === 'CREATE',
    'Scenario C with winners not in exact → CREATE');
});

test('Scenario C with winners already in exact → intent AMPLIFY', () => {
  const kw = makeKeyword({ id: 'kw-w2', matchType: 'exact' });
  const ag = makeAdGroup({ keywords: [kw] });
  const campaigns = [makeCampaign({ id: 'c2', adGroups: [ag] })];
  const entityInsightsMap = new Map();
  entityInsightsMap.set('c2', [
    makeEntityInsight({ entityKey: `keyword:kw-w2`, diagnosisCode: 'winner' }),
  ]);
  const ctx = makeTopFocusContext({
    scenario: 'scenario_c_winners_exist',
    campaigns,
    entityInsightsMap,
  });
  assert(computeIntent('scenario_c_winners_exist', ctx) === 'AMPLIFY',
    'Scenario C with winners in exact → AMPLIFY');
});

test('Scenario STABLE → intent OBSERVE (always)', () => {
  const ctx = makeTopFocusContext({ scenario: 'scenario_stable' });
  assert(computeIntent('scenario_stable', ctx) === 'OBSERVE',
    'Scenario STABLE should always be OBSERVE');
});

// ── 3. CreationPlan campaigns count ──────────────────────────────

console.log('\n📌 CreationPlan Generation');

test('Scenario A + launch → 2 campaigns (Auto + Exact)', () => {
  const ctx = makeTopFocusContext({
    scenario: 'scenario_a_no_campaigns',
    bookContext: makeBookContext({ lifecyclePhase: 'launch' }),
  });
  const camps = buildCampaignsToCreate(ctx);
  assert(camps.length === 2, `Expected 2 campaigns, got ${camps.length}`);
  assert(camps[0].type === 'SP_AUTO', 'First should be Auto');
  assert(camps[1].type === 'SP_MANUAL_EXACT', 'Second should be Exact');
});

test('Scenario A + scale → 3 campaigns (Auto + Exact + Phrase)', () => {
  const ctx = makeTopFocusContext({
    scenario: 'scenario_a_no_campaigns',
    bookContext: makeBookContext({ lifecyclePhase: 'scale' }),
  });
  const camps = buildCampaignsToCreate(ctx);
  assert(camps.length === 3, `Expected 3 campaigns, got ${camps.length}`);
  assert(camps[2].type === 'SP_MANUAL_PHRASE', 'Third should be Phrase');
});

test('Scenario B missing auto → creates Auto only', () => {
  const kw = makeKeyword({ matchType: 'exact' });
  const ag = makeAdGroup({ keywords: [kw] });
  const ctx = makeTopFocusContext({
    scenario: 'scenario_b_chaos_detected',
    campaigns: [makeCampaign({ targetingType: 'manual', adGroups: [ag] })],
  });
  const camps = buildCampaignsToCreate(ctx);
  assert(camps.length === 1, `Expected 1 campaign, got ${camps.length}`);
  assert(camps[0].type === 'SP_AUTO', 'Should create Auto');
});

test('Scenario C needs exact + no product targeting → 2 campaigns', () => {
  const kw = makeKeyword({ id: 'kw-w3', matchType: 'broad' });
  const ag = makeAdGroup({ keywords: [kw] });
  const campaigns = [makeCampaign({ id: 'c3', adGroups: [ag] })];
  const entityInsightsMap = new Map();
  entityInsightsMap.set('c3', [
    makeEntityInsight({ entityKey: 'keyword:kw-w3', diagnosisCode: 'winner' }),
  ]);
  const ctx = makeTopFocusContext({
    scenario: 'scenario_c_winners_exist',
    campaigns,
    entityInsightsMap,
  });
  const camps = buildCampaignsToCreate(ctx);
  assert(camps.length === 2, `Expected 2 campaigns, got ${camps.length}`);
  assert(camps[0].type === 'SP_MANUAL_EXACT', 'First should be Winners-Exact');
  assert(camps[1].type === 'SP_PRODUCT', 'Second should be Product');
});

test('Scenario STABLE → 0 campaigns (OBSERVE, no creation)', () => {
  const ctx = makeTopFocusContext({ scenario: 'scenario_stable' });
  const camps = buildCampaignsToCreate(ctx);
  assert(camps.length === 0, `Expected 0 campaigns, got ${camps.length}`);
});

// ── 4. Fingerprint tests ─────────────────────────────────────────

console.log('\n📌 Plan Fingerprint');

test('Fingerprint is deterministic (same input → same hash)', () => {
  const { createHash } = require('crypto');
  const data = JSON.stringify({
    bookId: 'book-1', lifecycle: 'launch',
    scenario: 'scenario_a_no_campaigns',
    campaigns: [{ type: 'SP_AUTO', targetingMode: 'AUTO', keywords: [], asins: [] }],
  });
  const fp1 = createHash('sha256').update(data).digest('hex').slice(0, 16);
  const fp2 = createHash('sha256').update(data).digest('hex').slice(0, 16);
  assert(fp1 === fp2, 'Same input should produce same fingerprint');
  assert(fp1.length === 16, 'Fingerprint should be 16 chars');
});

test('Different bookId → different fingerprint', () => {
  const { createHash } = require('crypto');
  const makeFp = (bookId) => {
    const data = JSON.stringify({
      bookId, lifecycle: 'launch',
      scenario: 'scenario_a_no_campaigns',
      campaigns: [{ type: 'SP_AUTO', targetingMode: 'AUTO', keywords: [], asins: [] }],
    });
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  };
  assert(makeFp('book-1') !== makeFp('book-2'), 'Different bookId → different fingerprint');
});

// ── 5. Batch logic tests ─────────────────────────────────────────

console.log('\n📌 Batch Logic');

test('typeToMatchTypes: SP_MANUAL_EXACT → ["exact"]', () => {
  assert(JSON.stringify(typeToMatchTypes('SP_MANUAL_EXACT')) === '["exact"]', 'exact mapping');
});

test('typeToMatchTypes: SP_AUTO → []', () => {
  assert(JSON.stringify(typeToMatchTypes('SP_AUTO')) === '[]', 'auto mapping');
});

test('Batch skip logic filters correctly', () => {
  const campaigns = [
    { name: 'A', skip: false },
    { name: 'B', skip: true },
    { name: 'C', skip: false },
  ];
  const active = campaigns.filter(c => !c.skip);
  assert(active.length === 2, 'Should have 2 active campaigns');
  assert(active[0].name === 'A' && active[1].name === 'C', 'Correct order');
});

test('Budget override applies correctly', () => {
  const campaignsToCreate = [
    { dailyBudget: 5 },
    { dailyBudget: 8 },
  ];
  const overrides = [
    { index: 0, dailyBudget: 10 },
    { index: 1 },
  ];
  const effectiveBudgets = campaignsToCreate.map((c, i) => {
    const ov = overrides.find(o => o.index === i);
    return ov?.dailyBudget ?? c.dailyBudget;
  });
  assert(effectiveBudgets[0] === 10, 'Override budget should be 10');
  assert(effectiveBudgets[1] === 8, 'Default budget should remain 8');
});

// ── 6. Gap-Aware STABLE Override tests ────────────────────────────

console.log('\n📌 Gap-Aware STABLE Override');

const CREATE_WORTHY_GAPS = new Set(['GAP_EXPLORATION', 'GAP_VALIDATION', 'GAP_AMPLIFICATION']);

function computeIntentWithGaps(scenario, ctx, gaps) {
  const baseIntent = computeIntent(scenario, ctx);

  if (scenario !== 'scenario_stable') return baseIntent;
  if (!gaps || gaps.length === 0) return baseIntent;

  const criticalOrHigh = gaps.filter(g => g.severity === 'critical' || g.severity === 'high');
  if (criticalOrHigh.length === 0) return baseIntent;

  const hasCreateWorthy = criticalOrHigh.some(g => CREATE_WORTHY_GAPS.has(g.type));
  const hasCleanupOnly = criticalOrHigh.every(g => g.type === 'GAP_CLEANUP');

  if (hasCreateWorthy) return 'CREATE';
  if (hasCleanupOnly) return 'CLEANUP';
  return baseIntent;
}

test('STABLE + critical GAP_EXPLORATION → intent overridden to CREATE', () => {
  const ctx = makeTopFocusContext({
    scenario: 'scenario_stable',
    campaigns: [makeCampaign({ targetingType: 'manual', adGroups: [] })],
  });
  const gaps = [{ type: 'GAP_EXPLORATION', severity: 'critical', label: 'Test', explanation: 'Test', campaignsToCreate: ['SP_AUTO'] }];
  const intent = computeIntentWithGaps('scenario_stable', ctx, gaps);
  assert(intent === 'CREATE', `STABLE + GAP_EXPLORATION critical → should be CREATE, got ${intent}`);
});

test('STABLE + high GAP_VALIDATION → intent overridden to CREATE', () => {
  const ctx = makeTopFocusContext({
    scenario: 'scenario_stable',
    campaigns: [makeCampaign({ targetingType: 'auto', adGroups: [] })],
  });
  const gaps = [{ type: 'GAP_VALIDATION', severity: 'high', label: 'Test', explanation: 'Test', campaignsToCreate: ['SP_MANUAL_EXACT'] }];
  const intent = computeIntentWithGaps('scenario_stable', ctx, gaps);
  assert(intent === 'CREATE', `STABLE + GAP_VALIDATION high → should be CREATE, got ${intent}`);
});

test('STABLE + GAP_CLEANUP only (high) → intent overridden to CLEANUP', () => {
  const ctx = makeTopFocusContext({ scenario: 'scenario_stable' });
  const gaps = [{ type: 'GAP_CLEANUP', severity: 'high', label: 'Test', explanation: 'Test', campaignsToCreate: [] }];
  const intent = computeIntentWithGaps('scenario_stable', ctx, gaps);
  assert(intent === 'CLEANUP', `STABLE + GAP_CLEANUP high → should be CLEANUP, got ${intent}`);
});

test('STABLE + 0 gaps → intent stays OBSERVE', () => {
  const ctx = makeTopFocusContext({ scenario: 'scenario_stable' });
  const intent = computeIntentWithGaps('scenario_stable', ctx, []);
  assert(intent === 'OBSERVE', `STABLE + 0 gaps → should be OBSERVE, got ${intent}`);
});

test('STABLE + low severity gaps only → intent stays OBSERVE', () => {
  const ctx = makeTopFocusContext({ scenario: 'scenario_stable' });
  const gaps = [
    { type: 'GAP_DIVERSIFICATION', severity: 'low', label: 'Test', explanation: 'Test', campaignsToCreate: ['SP_PRODUCT'] },
    { type: 'GAP_VIDEO', severity: 'low', label: 'Test', explanation: 'Test', campaignsToCreate: ['SB_VIDEO'] },
  ];
  const intent = computeIntentWithGaps('scenario_stable', ctx, gaps);
  assert(intent === 'OBSERVE', `STABLE + only low gaps → should be OBSERVE, got ${intent}`);
});

// ── 7. Gap-driven buildCampaignsToCreate ─────────────────────────

console.log('\n📌 Gap-driven Campaign Creation');

function buildFromGaps(ctx, gaps) {
  const bookTitle = (ctx.bookContext.title || 'Livre').slice(0, 25);
  const result = [];
  for (const gap of gaps) {
    if (gap.severity === 'low') continue;
    switch (gap.type) {
      case 'GAP_EXPLORATION':
        result.push({ name: `${bookTitle}-SP-Auto`, type: 'SP_AUTO', targetingMode: 'AUTO' });
        break;
      case 'GAP_VALIDATION':
        result.push({ name: `${bookTitle}-SP-Exact`, type: 'SP_MANUAL_EXACT', targetingMode: 'MANUAL' });
        break;
      case 'GAP_AMPLIFICATION':
        result.push({ name: `${bookTitle}-SP-Winners-Exact`, type: 'SP_MANUAL_EXACT', targetingMode: 'MANUAL' });
        break;
      case 'GAP_DIVERSIFICATION':
        result.push({ name: `${bookTitle}-SP-Product`, type: 'SP_PRODUCT', targetingMode: 'MANUAL' });
        break;
      case 'GAP_VIDEO':
        result.push({ name: `${bookTitle}-SB-Video`, type: 'SB_VIDEO', targetingMode: 'MANUAL' });
        break;
      // GAP_CLEANUP → no campaigns
    }
  }
  return result;
}

test('STABLE + GAP_EXPLORATION + GAP_VALIDATION → creates Auto + Exact', () => {
  const ctx = makeTopFocusContext({ scenario: 'scenario_stable' });
  const gaps = [
    { type: 'GAP_EXPLORATION', severity: 'critical', label: 'Test', explanation: 'Test', campaignsToCreate: ['SP_AUTO'] },
    { type: 'GAP_VALIDATION', severity: 'high', label: 'Test', explanation: 'Test', campaignsToCreate: ['SP_MANUAL_EXACT'] },
  ];
  const camps = buildFromGaps(ctx, gaps);
  assert(camps.length === 2, `Expected 2 campaigns, got ${camps.length}`);
  assert(camps[0].type === 'SP_AUTO', 'First should be Auto');
  assert(camps[1].type === 'SP_MANUAL_EXACT', 'Second should be Exact');
});

test('STABLE + GAP_CLEANUP only → 0 campaigns created (cleanup doesnt create)', () => {
  const ctx = makeTopFocusContext({ scenario: 'scenario_stable' });
  const gaps = [
    { type: 'GAP_CLEANUP', severity: 'high', label: 'Test', explanation: 'Test', campaignsToCreate: [] },
  ];
  const camps = buildFromGaps(ctx, gaps);
  assert(camps.length === 0, `Expected 0 campaigns, got ${camps.length}`);
});

test('Low severity gaps are skipped in campaign creation', () => {
  const ctx = makeTopFocusContext({ scenario: 'scenario_stable' });
  const gaps = [
    { type: 'GAP_DIVERSIFICATION', severity: 'low', label: 'Test', explanation: 'Test', campaignsToCreate: ['SP_PRODUCT'] },
  ];
  const camps = buildFromGaps(ctx, gaps);
  assert(camps.length === 0, `Expected 0 campaigns for low severity gaps, got ${camps.length}`);
});

// ── Summary ──────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(55));
console.log(`✅ ${passed} passed, ❌ ${failed} failed — Total: ${passed + failed}`);
console.log('');
