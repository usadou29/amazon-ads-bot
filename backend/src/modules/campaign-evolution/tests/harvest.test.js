/**
 * Tests unitaires : HarvestService
 * 14 tests couvrant extraction de winners, ASINs, negatives, search terms, multi-window fallback
 * Updated for v3 tolerant criteria:
 *   - Winners: orders >= 1 OR ACOS <= targetAcos × 1.2
 *   - ASINs: orders >= 1 OR CTR >= campaign avg CTR
 *   - Negatives: clicks >= 15 AND orders === 0
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
  const clicks = opts.clicks !== undefined ? opts.clicks : 20;
  const orders = opts.orders !== undefined ? opts.orders : 0;
  const acos = opts.acos !== undefined ? opts.acos : null;
  const impressions = opts.impressions !== undefined ? opts.impressions : 100;
  const spend = opts.spend !== undefined ? opts.spend : 10;
  return {
    entityKey,
    entityType: opts.entityType || 'keyword',
    diagnosisCode,
    eligibility: true,
    summaryFacts: { impressions, clicks, ctr: impressions > 0 ? clicks / impressions : 0, orders, cvr: clicks > 0 ? orders / clicks : 0, spend, sales: orders * 10, acos, periodDays: 14 },
    suggestedActions: [],
    confidenceScore: 0.8,
  };
}

function makeCtx(campaigns = [], insightsMap = new Map(), opts = {}) {
  return {
    scenario: opts.scenario || 'scenario_stable',
    bookContext: {
      id: 'book-1',
      title: 'Test Book Title',
      asin: 'B001',
      lifecyclePhase: opts.lifecycle || 'scale',
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
      lifecyclePhase: opts.lifecycle || 'scale',
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

// ── Load HarvestService ──────────────────────────────────────────

const { HarvestService } = require('../services/harvest.service');
const service = new HarvestService(null);

// ── Tests ────────────────────────────────────────────────────────

console.log('\n📌 Tolerant Winner Keyword Extraction (v3 criteria)');

test('Winner by orders >= 1 (any ACOS)', () => {
  const kw1 = makeKeyword('1', 'thriller psychologique', 'exact');
  const ag = makeAdGroup('ag1', [kw1]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'winner', { acos: 50, orders: 2 }), // High ACOS but has orders
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);
  assert(result.winnerKeywords.length === 1, `Expected 1 winner (orders >= 1), got ${result.winnerKeywords.length}`);
  assert(result.winnerKeywords[0].text === 'thriller psychologique', 'Expected correct keyword text');
});

test('Winner by ACOS <= targetAcos × 1.2 (even with 0 orders)', () => {
  const kw1 = makeKeyword('1', 'roman noir', 'broad');
  const ag = makeAdGroup('ag1', [kw1]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  // acosTarget = 30, threshold = 36. ACOS = 35 should qualify
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'boost_candidate', { acos: 35, orders: 0 }),
  ]);

  const ctx = makeCtx([camp], insightsMap, { acosTarget: 30 });
  const result = service.harvest(ctx);
  assert(result.winnerKeywords.length === 1, `Expected 1 winner (ACOS <= 36), got ${result.winnerKeywords.length}`);
});

test('Not winner if ACOS > targetAcos × 1.2 AND orders === 0', () => {
  const kw1 = makeKeyword('1', 'livre cher', 'exact');
  const ag = makeAdGroup('ag1', [kw1]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  // acosTarget = 30, threshold = 36. ACOS = 40 should NOT qualify with 0 orders
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'very_expensive', { acos: 40, orders: 0 }),
  ]);

  const ctx = makeCtx([camp], insightsMap, { acosTarget: 30 });
  const result = service.harvest(ctx);
  assert(result.winnerKeywords.length === 0, `Expected 0 winners, got ${result.winnerKeywords.length}`);
});

test('Sorts winners by orders descending', () => {
  const kw1 = makeKeyword('1', 'keyword-a', 'exact');
  const kw2 = makeKeyword('2', 'keyword-b', 'broad');
  const ag = makeAdGroup('ag1', [kw1, kw2]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'winner', { acos: 15, orders: 3 }),
    makeInsight('keyword:2', 'winner', { acos: 12, orders: 8 }),
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);
  assert(result.winnerKeywords.length === 2, 'Expected 2 winners');
  assert(result.winnerKeywords[0].text === 'keyword-b', `Expected keyword-b first (8 orders), got '${result.winnerKeywords[0].text}'`);
  assert(result.winnerKeywords[0].orders === 8, 'Expected 8 orders first');
});

test('Deduplicates winner keywords by text (case insensitive)', () => {
  const kw1 = makeKeyword('1', 'thriller', 'exact');
  const kw2 = makeKeyword('2', 'Thriller', 'broad');

  const ag1 = makeAdGroup('ag1', [kw1]);
  const ag2 = makeAdGroup('ag2', [kw2]);
  const camp1 = makeCampaign('c1', [ag1]);
  const camp2 = makeCampaign('c2', [ag2]);

  const insightsMap = new Map();
  insightsMap.set('c1', [makeInsight('keyword:1', 'winner', { orders: 5, acos: 15 })]);
  insightsMap.set('c2', [makeInsight('keyword:2', 'winner', { orders: 3, acos: 18 })]);

  const ctx = makeCtx([camp1, camp2], insightsMap);
  const result = service.harvest(ctx);
  assert(result.winnerKeywords.length === 1, `Expected 1 deduplicated winner, got ${result.winnerKeywords.length}`);
});

console.log('\n📌 Tolerant Winner ASIN Extraction (v3 criteria)');

test('ASIN winner by orders >= 1', () => {
  const tg1 = makeTarget('1', 'asinSameAs', 'B00ABCDEF1');
  const ag = makeAdGroup('ag1', [], [tg1]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('target:1', 'winner', { orders: 2, impressions: 100, clicks: 10 }),
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);
  assert(result.winnerAsins.length === 1, `Expected 1 ASIN, got ${result.winnerAsins.length}`);
  assert(result.winnerAsins[0] === 'B00ABCDEF1', 'Expected correct ASIN');
});

test('ASIN winner by CTR >= campaign avg CTR (even with 0 orders)', () => {
  const tg1 = makeTarget('1', 'asinSameAs', 'B00HIGH_CTR');
  const tg2 = makeTarget('2', 'asinSameAs', 'B00LOW_CTR');
  const ag = makeAdGroup('ag1', [], [tg1, tg2]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  // tg1: CTR = 20/100 = 0.20, tg2: CTR = 5/100 = 0.05. Avg CTR = 0.125
  insightsMap.set('c1', [
    makeInsight('target:1', 'boost_candidate', { orders: 0, impressions: 100, clicks: 20 }),
    makeInsight('target:2', 'new_no_data', { orders: 0, impressions: 100, clicks: 5 }),
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);
  // tg1 CTR (0.20) >= avg (0.125) → winner. tg2 CTR (0.05) < avg → not winner
  assert(result.winnerAsins.includes('B00HIGH_CTR'), 'Expected HIGH_CTR ASIN (CTR >= avg)');
  assert(!result.winnerAsins.includes('B00LOW_CTR'), 'Expected LOW_CTR ASIN excluded');
});

test('Non-asinSameAs targets are skipped', () => {
  const tg = makeTarget('1', 'asinCategorySameAs', 'cat123');
  const ag = makeAdGroup('ag1', [], [tg]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [makeInsight('target:1', 'winner', { orders: 5, impressions: 100, clicks: 10 })]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);
  assert(result.winnerAsins.length === 0, 'Expected 0 ASINs (non-asinSameAs skipped)');
});

console.log('\n📌 Negatives (v3 criteria: clicks >= 15 AND orders === 0)');

test('Negative: clicks >= 15 AND orders === 0', () => {
  const kw1 = makeKeyword('1', 'mauvais mot', 'broad');
  const kw2 = makeKeyword('2', 'bon mot', 'exact');
  const kw3 = makeKeyword('3', 'presque', 'phrase');

  const ag = makeAdGroup('ag1', [kw1, kw2, kw3]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'clicks_no_sales', { clicks: 20, orders: 0, acos: null }),
    makeInsight('keyword:2', 'winner', { clicks: 30, orders: 5, acos: 15 }),
    makeInsight('keyword:3', 'new_no_data', { clicks: 10, orders: 0, acos: null }), // Not enough clicks
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);

  assert(result.suggestedNegatives.length === 1, `Expected 1 negative, got ${result.suggestedNegatives.length}`);
  assert(result.suggestedNegatives.includes('mauvais mot'), 'Expected "mauvais mot" (clicks=20, orders=0)');
});

test('Not negative if clicks >= 15 but orders > 0', () => {
  const kw1 = makeKeyword('1', 'converting kw', 'broad');
  const ag = makeAdGroup('ag1', [kw1]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'boost_candidate', { clicks: 25, orders: 1, acos: 60 }),
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);
  assert(result.suggestedNegatives.length === 0, 'Expected 0 negatives (has orders)');
});

console.log('\n📌 Empty & Edge Cases');

test('Zero campaigns → empty harvest', () => {
  const ctx = makeCtx([], new Map());
  const result = service.harvest(ctx);
  assert(result.winnerKeywords.length === 0, 'Expected 0 winners');
  assert(result.winnerAsins.length === 0, 'Expected 0 ASINs');
  assert(result.suggestedNegatives.length === 0, 'Expected 0 negatives');
});

test('Archived keywords and campaigns are skipped', () => {
  const kw1 = makeKeyword('1', 'archived kw', 'exact', 'archived');
  const ag = makeAdGroup('ag1', [kw1]);
  const camp = makeCampaign('c1', [ag], { state: 'archived' });

  const insightsMap = new Map();
  insightsMap.set('c1', [makeInsight('keyword:1', 'winner', { orders: 5, acos: 15 })]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);
  assert(result.winnerKeywords.length === 0, 'Expected 0 (archived)');
});

test('userProvidedKeywords inferred from book title', () => {
  const ctx = makeCtx([], new Map());
  ctx.bookContext.title = 'Le Silence des Abysses Roman';
  const result = service.harvest(ctx);
  assert(result.userProvidedKeywords.length > 0, 'Expected inferred keywords');
  assert(result.userProvidedKeywords.includes('silence'), 'Expected "silence"');
  assert(result.userProvidedKeywords.includes('abysses'), 'Expected "abysses"');
  assert(result.userProvidedKeywords.includes('roman'), 'Expected "roman"');
});

// ── Summary ──────────────────────────────────────────────────────

console.log('\n───────────────────────────────────────────────────────');
console.log(`✅ ${passed} passed, ❌ ${failed} failed — Total: ${passed + failed}`);
