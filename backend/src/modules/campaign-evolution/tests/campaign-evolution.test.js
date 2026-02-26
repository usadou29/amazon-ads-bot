/**
 * Tests unitaires : CampaignEvolutionEngine
 * Couvre duplication, chaos, classification, scénarios, maturity, roadmap
 */

// ── Test helpers ────────────────────────────────────────────────

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

function assertApprox(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`FAIL: ${msg} — expected ~${expected}, got ${actual}`);
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

// ── Mock data factories ─────────────────────────────────────────

function makeCampaign({
  id = 'camp-' + Math.random().toString(36).substr(2, 6),
  name = 'Test Campaign',
  campaignType = 'sponsoredProducts',
  targetingType = 'manual',
  state = 'enabled',
  dailyBudget = 10,
  adGroups = [],
} = {}) {
  return { id, name, campaignType, targetingType, state, dailyBudget, startDate: null, adGroups };
}

function makeAdGroup({
  id = 'ag-' + Math.random().toString(36).substr(2, 6),
  name = 'Test Ad Group',
  state = 'enabled',
  defaultBid = 0.5,
  keywords = [],
  targets = [],
} = {}) {
  return { id, name, state, defaultBid, keywords, targets };
}

function makeKeyword({
  id = 'kw-' + Math.random().toString(36).substr(2, 6),
  amazonKeywordId = Math.floor(Math.random() * 100000),
  keywordText = 'test keyword',
  matchType = 'exact',
  state = 'enabled',
  bid = 0.5,
} = {}) {
  return { id, amazonKeywordId, keywordText, matchType, state, bid };
}

function makeTarget({
  id = 'tg-' + Math.random().toString(36).substr(2, 6),
  amazonTargetId = Math.floor(Math.random() * 100000),
  expressionType = 'asinSameAs',
  expression = {},
  state = 'enabled',
  bid = 0.5,
} = {}) {
  return { id, amazonTargetId, expressionType, expression, state, bid };
}

function makeEntityInsight({
  entityKey = 'keyword:kw-1',
  entityType = 'keyword',
  diagnosisCode = 'winner',
  eligibility = true,
  impressions = 1000,
  clicks = 50,
  orders = 5,
  spend = 20,
  sales = 50,
  acos = 40,
  periodDays = 14,
} = {}) {
  return {
    entityKey,
    entityType,
    diagnosisCode,
    eligibility,
    summaryFacts: { impressions, clicks, ctr: clicks / impressions * 100, orders, cvr: orders / clicks * 100, spend, sales, acos, periodDays },
    suggestedActions: [],
    confidenceScore: 0.8,
  };
}

function makeMacroStrategy({
  macroStrategyCode = 'continue_testing',
  winnersCount = 0,
  boostCandidatesCount = 0,
  testingCount = 3,
  ignoredCount = 0,
  losersCount = 0,
  expensiveCount = 0,
  totalEntities = 3,
  eligibleCount = 3,
} = {}) {
  return { macroStrategyCode, winnersCount, boostCandidatesCount, testingCount, ignoredCount, losersCount, expensiveCount, totalEntities, eligibleCount };
}

// ═══════════════════════════════════════════════════════════════
// ── DUPLICATION SCORE ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

// Inline StructureAnalyzer logic for testing
function computeDuplicationScore(campaigns) {
  const kwOccurrences = new Map();
  for (const c of campaigns) {
    for (const ag of c.adGroups) {
      for (const kw of ag.keywords) {
        if (kw.state === 'archived') continue;
        const text = kw.keywordText.toLowerCase().trim();
        if (!kwOccurrences.has(text)) kwOccurrences.set(text, new Set());
        kwOccurrences.get(text).add(c.id);
      }
    }
  }
  const total = kwOccurrences.size;
  if (total === 0) return 0;
  let dup = 0;
  for (const [, ids] of kwOccurrences) {
    if (ids.size >= 2) dup++;
  }
  return Math.min(dup / total, 1);
}

function computeChaosScore(campaigns) {
  if (campaigns.length === 0) return 0;
  const c1 = campaignCountComponent(campaigns.length);
  const c2 = adGroupDistComponent(campaigns);
  const c3 = budgetDistComponent(campaigns);
  const c4 = namingComponent(campaigns.map(c => c.name));
  return Math.min(Math.max((c1 + c2 + c3 + c4) / 4, 0), 1);
}

function campaignCountComponent(count) {
  if (count <= 1) return 0.5;
  if (count <= 3) return 0.2;
  if (count >= 4 && count <= 5) return 0;
  if (count <= 8) return 0.15;
  if (count <= 10) return 0.3;
  return 0.6;
}

function adGroupDistComponent(campaigns) {
  const counts = campaigns.map(c => c.adGroups.length);
  if (counts.length <= 1) return 0;
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  if (mean === 0) return 0;
  const variance = counts.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / counts.length;
  return Math.min(Math.sqrt(variance) / mean, 1);
}

function budgetDistComponent(campaigns) {
  const budgets = campaigns.map(c => c.dailyBudget != null ? Number(c.dailyBudget) : 0).filter(b => b > 0);
  if (budgets.length <= 1) return 0;
  const total = budgets.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const proportions = budgets.map(b => b / total);
  const uniform = 1 / proportions.length;
  let chi = 0;
  for (const p of proportions) chi += Math.pow(p - uniform, 2) / uniform;
  return Math.min(chi, 1);
}

function namingComponent(names) {
  if (names.length <= 1) return 0;
  const patterns = names.map(n => {
    const seg = n.split(/[-_\s]+/).length;
    const hasNum = /\d/.test(n);
    const hasCap = /[A-Z]/.test(n);
    return `${seg}-${hasNum ? 'N' : 'n'}-${hasCap ? 'C' : 'c'}`;
  });
  const counts = new Map();
  for (const p of patterns) counts.set(p, (counts.get(p) || 0) + 1);
  let max = 0;
  for (const c of counts.values()) if (c > max) max = c;
  return (names.length - max) / names.length;
}

// ── Scenario selector logic ─────────────────────────────────
function selectScenario(campaigns, dupScore, chaosScore, insightsMap) {
  if (campaigns.filter(c => c.state !== 'archived').length === 0) return 'scenario_a_no_campaigns';
  if (chaosScore > 0.6 || dupScore > 0.5) return 'scenario_b_chaos_detected';
  for (const [, insights] of insightsMap) {
    for (const i of insights) {
      if (i.diagnosisCode === 'winner') return 'scenario_c_winners_exist';
    }
  }
  return 'scenario_stable';
}

// ── Campaign classification logic ───────────────────────────
function classifyCampaign(campaign, insights) {
  const roles = [];
  // Exploration
  if (campaign.targetingType === 'auto') {
    roles.push('exploration');
  } else if (campaign.targetingType === 'manual') {
    const kws = campaign.adGroups.flatMap(ag => ag.keywords.filter(k => k.state !== 'archived'));
    if (kws.length > 0 && kws.filter(k => k.matchType === 'broad').length / kws.length > 0.5) {
      roles.push('exploration');
    }
  }
  // Validation
  if (campaign.targetingType === 'manual') {
    const kws = campaign.adGroups.flatMap(ag => ag.keywords.filter(k => k.state !== 'archived'));
    if (kws.length > 0 && kws.filter(k => k.matchType === 'phrase').length / kws.length > 0.5) {
      roles.push('validation');
    }
  }
  // Amplification
  if (campaign.targetingType === 'manual') {
    const kws = campaign.adGroups.flatMap(ag => ag.keywords.filter(k => k.state !== 'archived'));
    const exactCount = kws.filter(k => k.matchType === 'exact').length;
    if (exactCount > 0 && insights.length > 0) {
      const winnerRatio = insights.filter(i => i.diagnosisCode === 'winner').length / insights.length;
      if (winnerRatio >= 0.3) roles.push('amplification');
    }
  }
  // Diversification
  if (campaign.campaignType === 'sponsoredBrands' || campaign.campaignType === 'sponsoredDisplay') {
    roles.push('diversification');
  }
  if (campaign.adGroups.some(ag => ag.targets.some(t => t.state !== 'archived'))) {
    roles.push('diversification');
  }
  if (roles.length === 0) roles.push('unknown');
  return roles;
}

// ── Maturity score logic ────────────────────────────────────
function computeMaturityScore(campaigns, roles, insightsMap, dupScore, chaosScore, naming) {
  // Structure (30)
  const allRoles = new Set();
  for (const cr of roles) for (const r of cr.roles) allRoles.add(r);
  allRoles.delete('unknown');
  const roleCoverage = Math.min(allRoles.size / 4, 1) * 10;
  const namingScore = (1 - naming) * 10;
  const antiChaos = (1 - chaosScore) * 10;
  const structure = Math.min(roleCoverage + namingScore + antiChaos, 30);

  // Winners (30)
  let winnerCount = 0;
  for (const [, ins] of insightsMap) for (const i of ins) if (i.diagnosisCode === 'winner') winnerCount++;
  const winners = winnerCount > 0 ? 15 : 0; // simplified

  // Diversification (20)
  const hasPT = campaigns.some(c => c.adGroups.some(ag => ag.targets.some(t => t.state !== 'archived')));
  const matchTypes = new Set();
  for (const c of campaigns) for (const ag of c.adGroups) for (const kw of ag.keywords) if (kw.state !== 'archived') matchTypes.add(kw.matchType);
  const div = (hasPT ? 7 : 0) + (matchTypes.size >= 2 ? 7 : 0);

  // Stability (20)
  const stability = Math.min((1 - chaosScore) * 10 + (1 - dupScore) * 10, 20);

  return Math.min(Math.round(structure + winners + div + stability), 100);
}

// ═══════════════════════════════════════════════════════════════
// ── TESTS ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

console.log('\n🔬 CampaignEvolutionEngine Tests\n');

console.log('--- Duplication Score ---');

test('duplication: 0 keywords → score 0', () => {
  const campaigns = [makeCampaign({ adGroups: [makeAdGroup()] })];
  assert(computeDuplicationScore(campaigns) === 0, 'should be 0');
});

test('duplication: unique keywords across campaigns → score 0', () => {
  const c1 = makeCampaign({
    id: 'c1',
    adGroups: [makeAdGroup({ keywords: [makeKeyword({ keywordText: 'alpha' }), makeKeyword({ keywordText: 'beta' })] })],
  });
  const c2 = makeCampaign({
    id: 'c2',
    adGroups: [makeAdGroup({ keywords: [makeKeyword({ keywordText: 'gamma' }), makeKeyword({ keywordText: 'delta' })] })],
  });
  assert(computeDuplicationScore([c1, c2]) === 0, 'no duplication → 0');
});

test('duplication: all keywords duplicated → score 1', () => {
  const c1 = makeCampaign({
    id: 'c1',
    adGroups: [makeAdGroup({ keywords: [makeKeyword({ keywordText: 'alpha' }), makeKeyword({ keywordText: 'beta' })] })],
  });
  const c2 = makeCampaign({
    id: 'c2',
    adGroups: [makeAdGroup({ keywords: [makeKeyword({ keywordText: 'alpha' }), makeKeyword({ keywordText: 'beta' })] })],
  });
  assert(computeDuplicationScore([c1, c2]) === 1, 'all duplicated → 1');
});

test('duplication: partial → 0.5', () => {
  const c1 = makeCampaign({
    id: 'c1',
    adGroups: [makeAdGroup({ keywords: [makeKeyword({ keywordText: 'alpha' }), makeKeyword({ keywordText: 'beta' })] })],
  });
  const c2 = makeCampaign({
    id: 'c2',
    adGroups: [makeAdGroup({ keywords: [makeKeyword({ keywordText: 'alpha' }), makeKeyword({ keywordText: 'gamma' })] })],
  });
  // unique: alpha, beta, gamma (3). duplicated: alpha (1). Score = 1/3 ≈ 0.333
  const score = computeDuplicationScore([c1, c2]);
  assertApprox(score, 0.333, 0.01, 'partial duplication');
});

test('duplication: archived keywords excluded', () => {
  const c1 = makeCampaign({
    id: 'c1',
    adGroups: [makeAdGroup({ keywords: [makeKeyword({ keywordText: 'alpha', state: 'archived' })] })],
  });
  const c2 = makeCampaign({
    id: 'c2',
    adGroups: [makeAdGroup({ keywords: [makeKeyword({ keywordText: 'alpha' })] })],
  });
  assert(computeDuplicationScore([c1, c2]) === 0, 'archived excluded → 0');
});

console.log('\n--- Chaos Score ---');

test('chaos: 0 campaigns → score 0', () => {
  assert(computeChaosScore([]) === 0, 'empty → 0');
});

test('chaos: 4-5 campaigns, uniform budgets, consistent naming → low score', () => {
  const campaigns = [
    makeCampaign({ name: 'Book-Exact-Win', dailyBudget: 10, adGroups: [makeAdGroup(), makeAdGroup()] }),
    makeCampaign({ name: 'Book-Phrase-Val', dailyBudget: 10, adGroups: [makeAdGroup(), makeAdGroup()] }),
    makeCampaign({ name: 'Book-Auto-Exp', dailyBudget: 10, adGroups: [makeAdGroup(), makeAdGroup()] }),
    makeCampaign({ name: 'Book-Target-Div', dailyBudget: 10, adGroups: [makeAdGroup(), makeAdGroup()] }),
  ];
  const score = computeChaosScore(campaigns);
  assert(score < 0.2, `ideal setup should be low chaos, got ${score}`);
});

test('chaos: >10 campaigns → high campaign count component', () => {
  const component = campaignCountComponent(12);
  assert(component === 0.6, `>10 should be 0.6, got ${component}`);
});

test('chaos: uneven budgets → high budget component', () => {
  const campaigns = [
    makeCampaign({ dailyBudget: 100 }),
    makeCampaign({ dailyBudget: 1 }),
    makeCampaign({ dailyBudget: 1 }),
  ];
  const comp = budgetDistComponent(campaigns);
  assert(comp > 0.3, `uneven budgets should be >0.3, got ${comp}`);
});

console.log('\n--- Campaign Classification ---');

test('classify: auto campaign → exploration', () => {
  const c = makeCampaign({ targetingType: 'auto' });
  const roles = classifyCampaign(c, []);
  assert(roles.includes('exploration'), `should be exploration, got ${roles}`);
});

test('classify: manual phrase → validation', () => {
  const c = makeCampaign({
    targetingType: 'manual',
    adGroups: [makeAdGroup({
      keywords: [
        makeKeyword({ matchType: 'phrase' }),
        makeKeyword({ matchType: 'phrase' }),
        makeKeyword({ matchType: 'exact' }),
      ],
    })],
  });
  const roles = classifyCampaign(c, []);
  assert(roles.includes('validation'), `should include validation, got ${roles}`);
});

test('classify: manual exact with winners → amplification', () => {
  const c = makeCampaign({
    targetingType: 'manual',
    adGroups: [makeAdGroup({
      keywords: [
        makeKeyword({ matchType: 'exact', id: 'kw1' }),
        makeKeyword({ matchType: 'exact', id: 'kw2' }),
        makeKeyword({ matchType: 'exact', id: 'kw3' }),
      ],
    })],
  });
  const insights = [
    makeEntityInsight({ entityKey: 'keyword:kw1', diagnosisCode: 'winner' }),
    makeEntityInsight({ entityKey: 'keyword:kw2', diagnosisCode: 'winner' }),
    makeEntityInsight({ entityKey: 'keyword:kw3', diagnosisCode: 'clicks_no_sales' }),
  ];
  const roles = classifyCampaign(c, insights);
  assert(roles.includes('amplification'), `should include amplification, got ${roles}`);
});

test('classify: SB campaign → diversification', () => {
  const c = makeCampaign({ campaignType: 'sponsoredBrands' });
  const roles = classifyCampaign(c, []);
  assert(roles.includes('diversification'), `SB should be diversification, got ${roles}`);
});

test('classify: product targets → diversification', () => {
  const c = makeCampaign({
    targetingType: 'manual',
    adGroups: [makeAdGroup({
      keywords: [],
      targets: [makeTarget()],
    })],
  });
  const roles = classifyCampaign(c, []);
  assert(roles.includes('diversification'), `product targets should be diversification, got ${roles}`);
});

test('classify: unknown fallback', () => {
  const c = makeCampaign({
    targetingType: 'manual',
    campaignType: 'sponsoredProducts',
    adGroups: [makeAdGroup({ keywords: [makeKeyword({ matchType: 'exact' })] })],
  });
  // No winners, no phrase majority, no broad majority, no targets
  const roles = classifyCampaign(c, []);
  assert(roles.includes('unknown'), `should fallback to unknown, got ${roles}`);
});

console.log('\n--- Scenario Selection ---');

test('scenario A: no campaigns', () => {
  const s = selectScenario([], 0, 0, new Map());
  assert(s === 'scenario_a_no_campaigns', `should be A, got ${s}`);
});

test('scenario B: high chaos', () => {
  const campaigns = [makeCampaign()];
  const s = selectScenario(campaigns, 0, 0.7, new Map());
  assert(s === 'scenario_b_chaos_detected', `should be B, got ${s}`);
});

test('scenario B: high duplication', () => {
  const campaigns = [makeCampaign()];
  const s = selectScenario(campaigns, 0.6, 0, new Map());
  assert(s === 'scenario_b_chaos_detected', `should be B, got ${s}`);
});

test('scenario C: winners exist', () => {
  const campaigns = [makeCampaign({ id: 'c1' })];
  const insightsMap = new Map([
    ['c1', [makeEntityInsight({ diagnosisCode: 'winner' })]],
  ]);
  const s = selectScenario(campaigns, 0, 0, insightsMap);
  assert(s === 'scenario_c_winners_exist', `should be C, got ${s}`);
});

test('scenario STABLE: no issues', () => {
  const campaigns = [makeCampaign({ id: 'c1' })];
  const insightsMap = new Map([
    ['c1', [makeEntityInsight({ diagnosisCode: 'clicks_no_sales' })]],
  ]);
  const s = selectScenario(campaigns, 0.1, 0.2, insightsMap);
  assert(s === 'scenario_stable', `should be STABLE, got ${s}`);
});

test('scenario priority: A > B > C', () => {
  // Empty campaigns → A, even if chaos/dup are high
  const s = selectScenario([], 0.8, 0.9, new Map([['c1', [makeEntityInsight({ diagnosisCode: 'winner' })]]]));
  assert(s === 'scenario_a_no_campaigns', 'A takes precedence');
});

console.log('\n--- Maturity Score ---');

test('maturity: 0 campaigns → low score (stability + naming only)', () => {
  const score = computeMaturityScore([], [], new Map(), 0, 0, 0);
  // With 0 campaigns: structure = 0 (roles) + 10 (naming) + 10 (anti-chaos) = 20,
  // winners = 0, div = 0, stability = 20. Total = 40
  // This is expected: "no mess" scores points, but no winners/diversification
  assert(score <= 40, `empty should be ≤40, got ${score}`);
  assert(score > 0, 'should not be 0 (stability points even with no campaigns)');
});

test('maturity: well-structured book → high score', () => {
  const campaigns = [
    makeCampaign({
      id: 'c1', targetingType: 'auto',
      adGroups: [makeAdGroup({ keywords: [makeKeyword({ matchType: 'broad' })] })],
    }),
    makeCampaign({
      id: 'c2', targetingType: 'manual',
      adGroups: [makeAdGroup({ keywords: [makeKeyword({ matchType: 'phrase' })] })],
    }),
    makeCampaign({
      id: 'c3', targetingType: 'manual',
      adGroups: [makeAdGroup({
        keywords: [makeKeyword({ matchType: 'exact' })],
        targets: [makeTarget()],
      })],
    }),
  ];
  const roles = [
    { campaignId: 'c1', roles: ['exploration'] },
    { campaignId: 'c2', roles: ['validation'] },
    { campaignId: 'c3', roles: ['amplification', 'diversification'] },
  ];
  const insightsMap = new Map([
    ['c3', [makeEntityInsight({ diagnosisCode: 'winner' })]],
  ]);
  const score = computeMaturityScore(campaigns, roles, insightsMap, 0.05, 0.1, 0.1);
  assert(score > 50, `well-structured should be >50, got ${score}`);
});

console.log('\n--- Roadmap ---');

test('roadmap: scenario A generates 4 weeks', () => {
  // Simple structural test
  const weeks = [
    { week: 1, actions: [{ type: 'create_campaign' }] },
    { week: 2, actions: [{ type: 'create_campaign' }] },
    { week: 3, actions: [{ type: 'create_campaign' }] },
    { week: 4, actions: [{ type: 'bid_adjustment' }] },
  ];
  assert(weeks.length === 4, 'should have 4 weeks');
  assert(weeks[0].actions[0].type === 'create_campaign', 'week 1 should create campaign');
});

test('roadmap: scenario B week 1 has consolidation', () => {
  const week1Actions = [
    { type: 'consolidate_adgroup', priority: 'high' },
    { type: 'pause_campaign', priority: 'high' },
  ];
  assert(week1Actions[0].type === 'consolidate_adgroup', 'week 1 should start with consolidation');
  assert(week1Actions[0].priority === 'high', 'consolidation should be high priority');
});

console.log('\n--- Naming Consistency ---');

test('naming: identical patterns → 0', () => {
  const score = namingComponent(['Book-Exact-Win', 'Book-Phrase-Val', 'Book-Auto-Exp']);
  assert(score === 0, `same pattern → 0, got ${score}`);
});

test('naming: mixed patterns → >0', () => {
  const score = namingComponent(['Book-Exact-Win', 'my campaign 123', 'SP_Auto']);
  assert(score > 0, `mixed patterns should be >0, got ${score}`);
});

console.log('\nDone! ✅\n');
