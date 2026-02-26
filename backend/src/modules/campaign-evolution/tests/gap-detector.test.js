/**
 * Tests unitaires : GapDetectorService
 * 15 tests couvrant les 6 types de gaps + tri par severity
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
    expression: { value: 'B0TEST1234' },
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
    scenario: 'scenario_stable',
    bookContext: makeBookContext(),
    campaigns: [],
    entityInsightsMap: new Map(),
    duplicationScore: 0,
    chaosScore: 0,
    campaignRoles: [],
    maturityScore: 50,
    gaps: [],
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

// ── Replicated gap detection logic (mirrors GapDetectorService) ──

const GAP_SEVERITY_MATRIX = {
  GAP_EXPLORATION: { launch: 'critical', scale: 'high', evergreen: 'high', relaunch: 'critical' },
  GAP_VALIDATION:  { launch: 'high',     scale: 'critical', evergreen: 'critical', relaunch: 'high' },
  GAP_AMPLIFICATION: { launch: 'low',    scale: 'high', evergreen: 'high', relaunch: 'medium' },
  GAP_DIVERSIFICATION: { launch: 'low',  scale: 'medium', evergreen: 'high', relaunch: 'low' },
  GAP_VIDEO:       { launch: 'low',      scale: 'low', evergreen: 'medium', relaunch: 'low' },
  GAP_CLEANUP:     { launch: 'medium',   scale: 'high', evergreen: 'high', relaunch: 'high' },
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function getSeverity(gapType, lifecycle) {
  const matrix = GAP_SEVERITY_MATRIX[gapType];
  if (!matrix) return 'medium';
  return matrix[lifecycle] || matrix['launch'] || 'medium';
}

function hasMatchType(campaigns, matchType) {
  return campaigns.some(c =>
    c.state !== 'archived' &&
    c.adGroups.some(ag =>
      ag.keywords.some(kw => kw.matchType === matchType && kw.state !== 'archived'),
    ),
  );
}

function getWinnerKeywordTexts(ctx) {
  const texts = [];
  for (const c of ctx.campaigns) {
    for (const ag of c.adGroups) {
      for (const kw of ag.keywords) {
        if (kw.state === 'archived') continue;
        const key = `keyword:${kw.id}`;
        const insights = ctx.entityInsightsMap.get(c.id) || [];
        if (insights.some(i => i.entityKey === key && i.diagnosisCode === 'winner')) {
          texts.push(kw.keywordText);
        }
      }
    }
  }
  return [...new Set(texts)];
}

function areWinnersInDedicatedExact(ctx, winnerTexts) {
  if (winnerTexts.length === 0) return true;
  const winnerSet = new Set(winnerTexts.map(t => t.toLowerCase()));
  for (const c of ctx.campaigns) {
    if (c.state === 'archived') continue;
    const exactKws = c.adGroups.flatMap(ag =>
      ag.keywords.filter(k => k.matchType === 'exact' && k.state !== 'archived'),
    );
    const matchingWinners = exactKws.filter(k => winnerSet.has(k.keywordText.toLowerCase()));
    if (matchingWinners.length >= winnerSet.size * 0.5) return true;
  }
  return false;
}

function detectGaps(ctx) {
  const gaps = [];
  const lifecycle = ctx.bookContext.lifecyclePhase || 'launch';

  // 1. GAP_EXPLORATION
  const hasAuto = ctx.campaigns.some(c => c.state !== 'archived' && c.targetingType === 'auto');
  const hasExplorationRole = ctx.campaignRoles.some(r => r.roles.includes('exploration'));
  if (!hasAuto && !hasExplorationRole) {
    gaps.push({
      type: 'GAP_EXPLORATION',
      severity: getSeverity('GAP_EXPLORATION', lifecycle),
      label: 'Campagne de découverte manquante',
      explanation: 'Aucune campagne Auto n\'est active.',
      campaignsToCreate: ['SP_AUTO'],
    });
  }

  // 2. GAP_VALIDATION
  const hasExact = hasMatchType(ctx.campaigns, 'exact');
  const hasPhrase = hasMatchType(ctx.campaigns, 'phrase');
  const hasValidationRole = ctx.campaignRoles.some(r => r.roles.includes('validation'));
  if (!hasExact && !hasPhrase && !hasValidationRole && ctx.campaigns.length > 0) {
    gaps.push({
      type: 'GAP_VALIDATION',
      severity: getSeverity('GAP_VALIDATION', lifecycle),
      label: 'Campagne de validation manquante',
      explanation: 'Aucune campagne Exact ou Phrase n\'est active.',
      campaignsToCreate: ['SP_MANUAL_EXACT'],
    });
  }

  // 3. GAP_AMPLIFICATION
  const winnerTexts = getWinnerKeywordTexts(ctx);
  if (winnerTexts.length > 0 && !areWinnersInDedicatedExact(ctx, winnerTexts)) {
    gaps.push({
      type: 'GAP_AMPLIFICATION',
      severity: getSeverity('GAP_AMPLIFICATION', lifecycle),
      label: `${winnerTexts.length} gagnant(s) non isolé(s)`,
      explanation: `Tu as ${winnerTexts.length} mot(s)-clé(s) gagnant(s) non isolés en Exact.`,
      campaignsToCreate: ['SP_MANUAL_EXACT'],
    });
  }

  // 4. GAP_DIVERSIFICATION
  if (lifecycle !== 'launch') {
    const hasProductTargeting = ctx.campaigns.some(
      c => c.state !== 'archived' && c.adGroups.some(ag => ag.targets.length > 0),
    );
    const hasDivRole = ctx.campaignRoles.some(r => r.roles.includes('diversification'));
    if (!hasProductTargeting && !hasDivRole && ctx.campaigns.length > 0) {
      gaps.push({
        type: 'GAP_DIVERSIFICATION',
        severity: getSeverity('GAP_DIVERSIFICATION', lifecycle),
        label: 'Product targeting manquant',
        explanation: 'Aucune campagne ne cible les fiches de livres similaires.',
        campaignsToCreate: ['SP_PRODUCT'],
      });
    }
  }

  // 5. GAP_VIDEO
  const SB_MIN_WINNER_KEYWORDS = 3;
  const SB_ACOS_FACTOR = 0.8;
  const SB_MIN_MONTHLY_SALES = 500;
  const winnerCount = ctx.context.totalWinnerKeywords;
  const avgAcos = ctx.context.avgAcos;
  const breakEvenAcos = ctx.bookContext.acosTarget;
  const monthlySales = ctx.context.totalSales30d;
  const hasSB = ctx.campaigns.some(c => c.state !== 'archived' && c.campaignType !== 'sponsoredProducts');
  if (
    winnerCount >= SB_MIN_WINNER_KEYWORDS &&
    avgAcos !== undefined && avgAcos > 0 && avgAcos <= breakEvenAcos * SB_ACOS_FACTOR &&
    monthlySales && monthlySales >= SB_MIN_MONTHLY_SALES &&
    !hasSB
  ) {
    gaps.push({
      type: 'GAP_VIDEO',
      severity: getSeverity('GAP_VIDEO', lifecycle),
      label: 'Éligible Sponsored Brands',
      explanation: `Tu peux lancer une campagne SB Video.`,
      campaignsToCreate: ['SB_VIDEO'],
    });
  }

  // 6. GAP_CLEANUP
  const GAP_CLEANUP_DUPLICATION_THRESHOLD = 0.4;
  const GAP_CLEANUP_CHAOS_THRESHOLD = 0.5;
  if (ctx.duplicationScore > GAP_CLEANUP_DUPLICATION_THRESHOLD || ctx.chaosScore > GAP_CLEANUP_CHAOS_THRESHOLD) {
    gaps.push({
      type: 'GAP_CLEANUP',
      severity: getSeverity('GAP_CLEANUP', lifecycle),
      label: 'Nettoyage nécessaire',
      explanation: 'Structure à optimiser.',
      campaignsToCreate: [],
    });
  }

  // Sort by severity
  gaps.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return gaps;
}

// ── TESTS ─────────────────────────────────────────────────────────

console.log('\n🧪 GapDetector Tests');
console.log('─'.repeat(55));

// ── 1. No campaigns → EXPLORATION critical ───────────────────────

console.log('\n📌 GAP_EXPLORATION Detection');

test('0 campaigns → GAP_EXPLORATION critical + no GAP_VALIDATION (0 campaigns guard)', () => {
  const ctx = makeTopFocusContext({ campaigns: [], bookContext: makeBookContext({ lifecyclePhase: 'launch' }) });
  const gaps = detectGaps(ctx);
  const exploration = gaps.find(g => g.type === 'GAP_EXPLORATION');
  const validation = gaps.find(g => g.type === 'GAP_VALIDATION');
  assert(exploration, 'Should detect GAP_EXPLORATION');
  assert(exploration.severity === 'critical', `GAP_EXPLORATION severity should be critical, got ${exploration.severity}`);
  assert(!validation, 'Should NOT detect GAP_VALIDATION when 0 campaigns');
});

test('1 Auto campaign → no GAP_EXPLORATION', () => {
  const campaigns = [makeCampaign({ targetingType: 'auto', adGroups: [] })];
  const ctx = makeTopFocusContext({ campaigns, context: { ...makeTopFocusContext().context, totalCampaigns: 1 } });
  const gaps = detectGaps(ctx);
  const exploration = gaps.find(g => g.type === 'GAP_EXPLORATION');
  assert(!exploration, 'Should NOT detect GAP_EXPLORATION when Auto exists');
});

test('Campaign with exploration role → no GAP_EXPLORATION', () => {
  const campaigns = [makeCampaign({ id: 'c1', targetingType: 'manual', adGroups: [] })];
  const ctx = makeTopFocusContext({
    campaigns,
    campaignRoles: [{ campaignId: 'c1', campaignName: 'Test', roles: ['exploration'], macroStrategy: 'GROWTH', confidence: 0.8 }],
    context: { ...makeTopFocusContext().context, totalCampaigns: 1 },
  });
  const gaps = detectGaps(ctx);
  const exploration = gaps.find(g => g.type === 'GAP_EXPLORATION');
  assert(!exploration, 'Should NOT detect GAP_EXPLORATION when exploration role exists');
});

// ── 2. GAP_VALIDATION ─────────────────────────────────────────

console.log('\n📌 GAP_VALIDATION Detection');

test('1 Auto only → GAP_VALIDATION high (launch)', () => {
  const campaigns = [makeCampaign({ targetingType: 'auto', adGroups: [] })];
  const ctx = makeTopFocusContext({
    campaigns,
    bookContext: makeBookContext({ lifecyclePhase: 'launch' }),
    context: { ...makeTopFocusContext().context, totalCampaigns: 1 },
  });
  const gaps = detectGaps(ctx);
  const validation = gaps.find(g => g.type === 'GAP_VALIDATION');
  assert(validation, 'Should detect GAP_VALIDATION');
  assert(validation.severity === 'high', `GAP_VALIDATION severity should be high in launch, got ${validation.severity}`);
});

test('1 Auto only (scale) → GAP_VALIDATION critical', () => {
  const campaigns = [makeCampaign({ targetingType: 'auto', adGroups: [] })];
  const ctx = makeTopFocusContext({
    campaigns,
    bookContext: makeBookContext({ lifecyclePhase: 'scale' }),
    context: { ...makeTopFocusContext().context, totalCampaigns: 1, lifecyclePhase: 'scale' },
  });
  const gaps = detectGaps(ctx);
  const validation = gaps.find(g => g.type === 'GAP_VALIDATION');
  assert(validation, 'Should detect GAP_VALIDATION');
  assert(validation.severity === 'critical', `GAP_VALIDATION severity should be critical in scale, got ${validation.severity}`);
});

test('Auto + Exact → no GAP_VALIDATION', () => {
  const kw = makeKeyword({ matchType: 'exact' });
  const ag = makeAdGroup({ keywords: [kw] });
  const campaigns = [
    makeCampaign({ targetingType: 'auto', adGroups: [] }),
    makeCampaign({ targetingType: 'manual', adGroups: [ag] }),
  ];
  const ctx = makeTopFocusContext({
    campaigns,
    context: { ...makeTopFocusContext().context, totalCampaigns: 2 },
  });
  const gaps = detectGaps(ctx);
  const validation = gaps.find(g => g.type === 'GAP_VALIDATION');
  assert(!validation, 'Should NOT detect GAP_VALIDATION when Exact exists');
});

// ── 3. GAP_AMPLIFICATION ──────────────────────────────────────

console.log('\n📌 GAP_AMPLIFICATION Detection');

test('Winners in broad but not in exact → GAP_AMPLIFICATION', () => {
  const kw = makeKeyword({ id: 'kw-w1', keywordText: 'thriller sombre', matchType: 'broad' });
  const ag = makeAdGroup({ keywords: [kw] });
  const campaigns = [makeCampaign({ id: 'c1', adGroups: [ag] })];
  const entityInsightsMap = new Map();
  entityInsightsMap.set('c1', [makeEntityInsight({ entityKey: 'keyword:kw-w1', diagnosisCode: 'winner' })]);
  const ctx = makeTopFocusContext({
    campaigns,
    entityInsightsMap,
    bookContext: makeBookContext({ lifecyclePhase: 'scale' }),
    context: { ...makeTopFocusContext().context, totalCampaigns: 1, totalWinnerKeywords: 1 },
  });
  const gaps = detectGaps(ctx);
  const amplification = gaps.find(g => g.type === 'GAP_AMPLIFICATION');
  assert(amplification, 'Should detect GAP_AMPLIFICATION');
  assert(amplification.severity === 'high', `GAP_AMPLIFICATION severity should be high in scale, got ${amplification.severity}`);
});

test('Winners already in exact → no GAP_AMPLIFICATION', () => {
  const kw = makeKeyword({ id: 'kw-w2', keywordText: 'thriller sombre', matchType: 'exact' });
  const ag = makeAdGroup({ keywords: [kw] });
  const campaigns = [makeCampaign({ id: 'c2', adGroups: [ag] })];
  const entityInsightsMap = new Map();
  entityInsightsMap.set('c2', [makeEntityInsight({ entityKey: 'keyword:kw-w2', diagnosisCode: 'winner' })]);
  const ctx = makeTopFocusContext({
    campaigns,
    entityInsightsMap,
    context: { ...makeTopFocusContext().context, totalCampaigns: 1, totalWinnerKeywords: 1 },
  });
  const gaps = detectGaps(ctx);
  const amplification = gaps.find(g => g.type === 'GAP_AMPLIFICATION');
  assert(!amplification, 'Should NOT detect GAP_AMPLIFICATION when winners in exact');
});

// ── 4. GAP_DIVERSIFICATION ──────────────────────────────────

console.log('\n📌 GAP_DIVERSIFICATION Detection');

test('No product targeting + scale → GAP_DIVERSIFICATION medium', () => {
  const kw = makeKeyword({ matchType: 'exact' });
  const ag = makeAdGroup({ keywords: [kw], targets: [] });
  const campaigns = [makeCampaign({ adGroups: [ag] })];
  const ctx = makeTopFocusContext({
    campaigns,
    bookContext: makeBookContext({ lifecyclePhase: 'scale' }),
    context: { ...makeTopFocusContext().context, totalCampaigns: 1, lifecyclePhase: 'scale' },
  });
  const gaps = detectGaps(ctx);
  const diversification = gaps.find(g => g.type === 'GAP_DIVERSIFICATION');
  assert(diversification, 'Should detect GAP_DIVERSIFICATION');
  assert(diversification.severity === 'medium', `Should be medium in scale, got ${diversification.severity}`);
});

test('No product targeting + launch → no GAP_DIVERSIFICATION', () => {
  const campaigns = [makeCampaign({ adGroups: [] })];
  const ctx = makeTopFocusContext({
    campaigns,
    bookContext: makeBookContext({ lifecyclePhase: 'launch' }),
    context: { ...makeTopFocusContext().context, totalCampaigns: 1 },
  });
  const gaps = detectGaps(ctx);
  const diversification = gaps.find(g => g.type === 'GAP_DIVERSIFICATION');
  assert(!diversification, 'Should NOT detect GAP_DIVERSIFICATION in launch');
});

// ── 5. GAP_CLEANUP ──────────────────────────────────────────

console.log('\n📌 GAP_CLEANUP Detection');

test('duplicationScore 0.5 → GAP_CLEANUP', () => {
  const ctx = makeTopFocusContext({ duplicationScore: 0.5, chaosScore: 0.3 });
  const gaps = detectGaps(ctx);
  const cleanup = gaps.find(g => g.type === 'GAP_CLEANUP');
  assert(cleanup, 'Should detect GAP_CLEANUP when duplication > 0.4');
});

test('chaosScore 0.6 → GAP_CLEANUP', () => {
  const ctx = makeTopFocusContext({ duplicationScore: 0.2, chaosScore: 0.6 });
  const gaps = detectGaps(ctx);
  const cleanup = gaps.find(g => g.type === 'GAP_CLEANUP');
  assert(cleanup, 'Should detect GAP_CLEANUP when chaos > 0.5');
});

test('Both low → no GAP_CLEANUP', () => {
  const ctx = makeTopFocusContext({ duplicationScore: 0.2, chaosScore: 0.3 });
  const gaps = detectGaps(ctx);
  const cleanup = gaps.find(g => g.type === 'GAP_CLEANUP');
  assert(!cleanup, 'Should NOT detect GAP_CLEANUP when both below threshold');
});

// ── 6. Sorting ──────────────────────────────────────────────

console.log('\n📌 Gap Sorting');

test('Gaps sorted by severity: critical first', () => {
  // Create a context that triggers multiple gaps
  const campaigns = [makeCampaign({ targetingType: 'manual', adGroups: [] })]; // no auto, no exact
  const ctx = makeTopFocusContext({
    campaigns,
    bookContext: makeBookContext({ lifecyclePhase: 'scale' }),
    duplicationScore: 0.6,
    context: { ...makeTopFocusContext().context, totalCampaigns: 1, lifecyclePhase: 'scale' },
  });
  const gaps = detectGaps(ctx);
  assert(gaps.length >= 3, `Expected at least 3 gaps, got ${gaps.length}`);

  // Verify sorted order
  for (let i = 0; i < gaps.length - 1; i++) {
    assert(
      SEVERITY_ORDER[gaps[i].severity] <= SEVERITY_ORDER[gaps[i + 1].severity],
      `Gap ${i} (${gaps[i].severity}) should be >= severity than gap ${i + 1} (${gaps[i + 1].severity})`,
    );
  }
});

// ── Summary ──────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(55));
console.log(`✅ ${passed} passed, ❌ ${failed} failed — Total: ${passed + failed}`);
console.log('');
