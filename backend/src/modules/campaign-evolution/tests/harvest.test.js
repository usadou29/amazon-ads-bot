/**
 * Tests unitaires : HarvestService
 * 10 tests couvrant extraction de winners, ASINs, negatives, search terms, multi-window fallback
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

function makeInsight(entityKey, diagnosisCode, acos = null, orders = 0) {
  return {
    entityKey,
    entityType: 'keyword',
    diagnosisCode,
    eligibility: true,
    summaryFacts: { impressions: 100, clicks: 20, ctr: 0.2, orders, cvr: 0.05, spend: 10, sales: 50, acos, periodDays: 14 },
    suggestedActions: [],
    confidenceScore: 0.8,
  };
}

function makeCtx(campaigns = [], insightsMap = new Map(), opts = {}) {
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

// Create a mock instance (no DB needed for sync methods)
const service = new HarvestService(null);

// ── Tests ────────────────────────────────────────────────────────

console.log('\n📌 Winner Keyword Extraction');

test('Extracts winner keywords from entityInsightsMap', () => {
  const kw1 = makeKeyword('1', 'thriller psychologique', 'exact');
  const kw2 = makeKeyword('2', 'roman noir', 'broad');
  const kw3 = makeKeyword('3', 'livre fantastique', 'exact');

  const ag = makeAdGroup('ag1', [kw1, kw2, kw3]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'winner', 15, 5),
    makeInsight('keyword:2', 'boost_candidate', 25, 2),
    makeInsight('keyword:3', 'winner', 12, 8),
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);

  assert(result.winnerKeywords.length === 2, `Expected 2 winners, got ${result.winnerKeywords.length}`);
  // Sorted by orders desc: kw3 (8 orders) first, kw1 (5 orders) second
  assert(result.winnerKeywords[0].text === 'livre fantastique', `Expected first winner to be 'livre fantastique', got '${result.winnerKeywords[0].text}'`);
  assert(result.winnerKeywords[1].text === 'thriller psychologique', `Expected second winner, got '${result.winnerKeywords[1].text}'`);
  assert(result.winnerKeywords[0].orders === 8, `Expected 8 orders, got ${result.winnerKeywords[0].orders}`);
  assert(result.winnerKeywords[0].acos === 12, `Expected acos 12, got ${result.winnerKeywords[0].acos}`);
});

test('Deduplicates winner keywords by text (case insensitive)', () => {
  const kw1 = makeKeyword('1', 'thriller', 'exact');
  const kw2 = makeKeyword('2', 'Thriller', 'broad'); // Same text different case

  const ag1 = makeAdGroup('ag1', [kw1]);
  const ag2 = makeAdGroup('ag2', [kw2]);
  const camp1 = makeCampaign('c1', [ag1]);
  const camp2 = makeCampaign('c2', [ag2]);

  const insightsMap = new Map();
  insightsMap.set('c1', [makeInsight('keyword:1', 'winner', 15, 5)]);
  insightsMap.set('c2', [makeInsight('keyword:2', 'winner', 18, 3)]);

  const ctx = makeCtx([camp1, camp2], insightsMap);
  const result = service.harvest(ctx);

  assert(result.winnerKeywords.length === 1, `Expected 1 deduplicated winner, got ${result.winnerKeywords.length}`);
});

test('Zero winners + zero campaigns → empty harvest', () => {
  const ctx = makeCtx([], new Map());
  const result = service.harvest(ctx);

  assert(result.winnerKeywords.length === 0, 'Expected 0 winners');
  assert(result.winnerAsins.length === 0, 'Expected 0 ASINs');
  assert(result.suggestedNegatives.length === 0, 'Expected 0 negatives');
  assert(result.winnerSearchTerms.length === 0, 'Expected 0 search terms');
});

test('Archived keywords are skipped', () => {
  const kw1 = makeKeyword('1', 'test keyword', 'exact', 'archived');
  const ag = makeAdGroup('ag1', [kw1]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [makeInsight('keyword:1', 'winner', 15, 5)]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);

  assert(result.winnerKeywords.length === 0, 'Expected 0 winners (archived skipped)');
});

console.log('\n📌 Winner ASIN Extraction');

test('Extracts winner ASINs from product targets', () => {
  const tg1 = makeTarget('1', 'asinSameAs', 'B00ABCDEF1');
  const tg2 = makeTarget('2', 'asinSameAs', 'B00ABCDEF2');
  const tg3 = makeTarget('3', 'asinCategorySameAs', 'cat123'); // Not asinSameAs

  const ag = makeAdGroup('ag1', [], [tg1, tg2, tg3]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('target:1', 'winner', 10, 5),
    makeInsight('target:2', 'winner', 12, 3),
    makeInsight('target:3', 'winner', 8, 7), // winner but not asinSameAs
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);

  assert(result.winnerAsins.length === 2, `Expected 2 ASINs, got ${result.winnerAsins.length}`);
  assert(result.winnerAsins.includes('B00ABCDEF1'), 'Expected ASIN B00ABCDEF1');
  assert(result.winnerAsins.includes('B00ABCDEF2'), 'Expected ASIN B00ABCDEF2');
});

console.log('\n📌 Suggested Negatives Extraction');

test('Extracts negatives from very_expensive and clicks_no_sales keywords', () => {
  const kw1 = makeKeyword('1', 'mauvais mot', 'broad');
  const kw2 = makeKeyword('2', 'bon mot', 'exact');
  const kw3 = makeKeyword('3', 'terrible mot', 'phrase');

  const ag = makeAdGroup('ag1', [kw1, kw2, kw3]);
  const camp = makeCampaign('c1', [ag]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'very_expensive', 80, 1),
    makeInsight('keyword:2', 'winner', 15, 5),
    makeInsight('keyword:3', 'clicks_no_sales', null, 0),
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);

  assert(result.suggestedNegatives.length === 2, `Expected 2 negatives, got ${result.suggestedNegatives.length}`);
  assert(result.suggestedNegatives.includes('mauvais mot'), 'Expected "mauvais mot" in negatives');
  assert(result.suggestedNegatives.includes('terrible mot'), 'Expected "terrible mot" in negatives');
});

test('Negatives are deduplicated (case insensitive)', () => {
  const kw1 = makeKeyword('1', 'Bad Keyword', 'broad');
  const kw2 = makeKeyword('2', 'bad keyword', 'exact');

  const ag1 = makeAdGroup('ag1', [kw1]);
  const ag2 = makeAdGroup('ag2', [kw2]);
  const camp = makeCampaign('c1', [ag1, ag2]);

  const insightsMap = new Map();
  insightsMap.set('c1', [
    makeInsight('keyword:1', 'very_expensive', 80, 1),
    makeInsight('keyword:2', 'clicks_no_sales', null, 0),
  ]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);

  assert(result.suggestedNegatives.length === 1, `Expected 1 deduplicated negative, got ${result.suggestedNegatives.length}`);
});

console.log('\n📌 Lifecycle Strategic Days');

test('harvest uses lifecycle-specific window days', () => {
  const ctx1 = makeCtx([], new Map(), { lifecycle: 'launch' });
  const r1 = service.harvest(ctx1);
  assert(r1.windowDays === 7, `Expected 7 for launch, got ${r1.windowDays}`);

  const ctx2 = makeCtx([], new Map(), { lifecycle: 'evergreen' });
  const r2 = service.harvest(ctx2);
  assert(r2.windowDays === 30, `Expected 30 for evergreen, got ${r2.windowDays}`);

  const ctx3 = makeCtx([], new Map(), { lifecycle: 'scale' });
  const r3 = service.harvest(ctx3);
  assert(r3.windowDays === 14, `Expected 14 for scale, got ${r3.windowDays}`);
});

test('Custom targetDays overrides lifecycle default', () => {
  const ctx = makeCtx([], new Map(), { lifecycle: 'launch' });
  const result = service.harvest(ctx, 30);
  assert(result.windowDays === 30, `Expected 30 (custom), got ${result.windowDays}`);
});

console.log('\n📌 Archived Campaign Handling');

test('Archived campaigns are skipped entirely', () => {
  const kw = makeKeyword('1', 'good keyword', 'exact');
  const ag = makeAdGroup('ag1', [kw]);
  const camp = makeCampaign('c1', [ag], { state: 'archived' });

  const insightsMap = new Map();
  insightsMap.set('c1', [makeInsight('keyword:1', 'winner', 15, 5)]);

  const ctx = makeCtx([camp], insightsMap);
  const result = service.harvest(ctx);

  assert(result.winnerKeywords.length === 0, 'Expected 0 winners (campaign archived)');
});

// ── Summary ──────────────────────────────────────────────────────

console.log('\n───────────────────────────────────────────────────────');
console.log(`✅ ${passed} passed, ❌ ${failed} failed — Total: ${passed + failed}`);
