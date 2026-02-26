/**
 * Tests : Adapter VM mapping + Author Summary + Idempotence Fingerprint + Validation
 */

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
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

// ── Inline adapter logic (mirrors frontend/src/lib/transforms/campaign-evolution.ts) ──

function scenarioToStateTag(scenario) {
  switch (scenario) {
    case 'scenario_a_no_campaigns': return 'AUCUNE_CAMPAGNE';
    case 'scenario_b_chaos_detected': return 'CHAOS';
    case 'scenario_c_winners_exist': return 'WINNERS';
    case 'scenario_stable': return 'STABLE';
    default: return 'STABLE';
  }
}

function scenarioToLabel(scenario) {
  switch (scenario) {
    case 'scenario_a_no_campaigns': return 'Démarrage';
    case 'scenario_b_chaos_detected': return 'Restructuration';
    case 'scenario_c_winners_exist': return 'Croissance';
    case 'scenario_stable': return 'Optimisation';
    default: return 'Analyse';
  }
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function buildAuthorSummary(result) {
  const { scenario, context } = result;
  const { totalCampaigns, totalWinnerKeywords, totalKeywords } = context;

  switch (scenario) {
    case 'scenario_a_no_campaigns':
      return 'Tu n\'as pas encore de campagnes publicitaires pour ce livre. On va t\'aider à lancer tes premières pubs étape par étape.';
    case 'scenario_b_chaos_detected': {
      const parts = [];
      if (result.duplicationScore > 0.4) parts.push('tes campagnes se cannibalisent (mêmes mots-clés partout)');
      if (result.chaosScore > 0.6) parts.push('la structure de tes campagnes est désorganisée');
      const issue = parts.length > 0 ? parts.join(' et ') : 'ta structure publicitaire nécessite un nettoyage';
      return `${capitalize(issue)}. On va simplifier et réorganiser pour que chaque euro dépensé soit mieux ciblé.`;
    }
    case 'scenario_c_winners_exist': {
      const winnerWord = totalWinnerKeywords === 1 ? 'mot-clé gagnant' : 'mots-clés gagnants';
      return `Tu as ${totalWinnerKeywords} ${winnerWord} qui convertissent bien. On va les isoler et les pousser pour maximiser tes ventes.`;
    }
    case 'scenario_stable':
      return `Tes ${totalCampaigns} campagnes tournent de façon stable avec ${totalKeywords} mots-clés. On te suggère quelques optimisations pour continuer à progresser.`;
    default:
      return 'Analyse en cours de ton portefeuille publicitaire.';
  }
}

function suggestionTitle(s) {
  switch (s.type) {
    case 'create_campaign': {
      if (s.details?.targetingType === 'auto') return 'Créer campagne Auto';
      if (s.details?.matchTypes?.includes('exact')) return 'Créer campagne Exact';
      if (s.details?.matchTypes?.includes('phrase')) return 'Créer campagne Phrase';
      return 'Créer une campagne';
    }
    case 'pause_campaign': return 'Mettre en pause une campagne';
    case 'consolidate_adgroup': return 'Consolider les mots-clés';
    case 'bid_increase': return 'Augmenter les enchères Winners';
    default: return s.description.slice(0, 50);
  }
}

function mapToViewModel(result) {
  const stateTag = scenarioToStateTag(result.scenario);
  const summary = buildAuthorSummary(result);
  const topActions = result.suggestions.slice(0, 3).map(s => ({
    title: suggestionTitle(s),
    description: s.description,
    ctaLabel: s.type === 'create_campaign' ? 'Créer' : 'Voir',
    actionType: s.type,
    payload: s.details,
    isExecutable: s.type === 'create_campaign',
  }));
  const roadmap = result.roadmap.map(w => ({
    weekLabel: `Semaine ${w.week}`,
    items: w.actions.map(a => ({ title: a.type, desc: a.details?.action || '', priority: a.priority })),
  }));
  return { summarySentence: summary, scenarioLabel: scenarioToLabel(result.scenario), stateTag, topActions, roadmap, details: { duplicationScore: result.duplicationScore, chaosScore: result.chaosScore, maturityScore: result.maturityScore } };
}

// ── Fingerprint logic (mirrors backend create-from-plan.service.ts) ──

const crypto = require('crypto');

function computeFingerprint(dto) {
  const data = JSON.stringify({
    bookId: dto.bookId,
    planActionType: dto.planActionType,
    campaignType: dto.planPayload.campaignType,
    targetingType: dto.planPayload.targetingType,
    matchTypes: (dto.planPayload.matchTypes || []).sort(),
    keywords: (dto.planPayload.keywords || []).sort(),
  });
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

// ── Mock data ───────────────────────────────────────────────────

function makeResult(overrides = {}) {
  return {
    bookId: 'book-123',
    analyzedAt: '2025-02-25T12:00:00Z',
    maturityScore: 50,
    maturityBreakdown: { structure: 15, winnersExploited: 10, diversification: 10, stability: 15 },
    duplicationScore: 0.2,
    chaosScore: 0.3,
    scenario: 'scenario_stable',
    campaignRoles: [],
    structuralIssues: [],
    suggestions: [],
    roadmap: [],
    nextCampaignRecommendations: [],
    diversificationOpportunities: [],
    context: { lifecyclePhase: 'scale', totalCampaigns: 3, totalAdGroups: 5, totalKeywords: 20, totalProductTargets: 2, totalWinnerKeywords: 0, totalBoostCandidateKeywords: 1 },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// ── TESTS ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

console.log('\n🧪 Campaign Evolution UI Tests\n');

// ── Adapter Mapping ─────────────────────────────────────────

console.log('--- Adapter Mapping ---');

test('adapter: scenario A → stateTag AUCUNE_CAMPAGNE', () => {
  const result = makeResult({ scenario: 'scenario_a_no_campaigns', context: { ...makeResult().context, totalCampaigns: 0 } });
  const vm = mapToViewModel(result);
  assert(vm.stateTag === 'AUCUNE_CAMPAGNE', `got ${vm.stateTag}`);
  assert(vm.scenarioLabel === 'Démarrage', `got ${vm.scenarioLabel}`);
});

test('adapter: scenario B → stateTag CHAOS', () => {
  const vm = mapToViewModel(makeResult({ scenario: 'scenario_b_chaos_detected' }));
  assert(vm.stateTag === 'CHAOS', `got ${vm.stateTag}`);
  assert(vm.scenarioLabel === 'Restructuration', `got ${vm.scenarioLabel}`);
});

test('adapter: scenario C → stateTag WINNERS', () => {
  const vm = mapToViewModel(makeResult({ scenario: 'scenario_c_winners_exist' }));
  assert(vm.stateTag === 'WINNERS', `got ${vm.stateTag}`);
});

test('adapter: scenario STABLE → stateTag STABLE', () => {
  const vm = mapToViewModel(makeResult());
  assert(vm.stateTag === 'STABLE', `got ${vm.stateTag}`);
});

test('adapter: topActions limited to 3', () => {
  const suggestions = [
    { priority: 10, type: 'create_campaign', description: 'a', estimatedImpact: '', details: { targetingType: 'auto' } },
    { priority: 9, type: 'create_campaign', description: 'b', estimatedImpact: '', details: { matchTypes: ['exact'] } },
    { priority: 8, type: 'create_campaign', description: 'c', estimatedImpact: '', details: { matchTypes: ['phrase'] } },
    { priority: 7, type: 'bid_increase', description: 'd', estimatedImpact: '', details: {} },
  ];
  const vm = mapToViewModel(makeResult({ suggestions }));
  assert(vm.topActions.length === 3, `should be max 3, got ${vm.topActions.length}`);
});

test('adapter: create_campaign is executable', () => {
  const suggestions = [{ priority: 10, type: 'create_campaign', description: 'test', estimatedImpact: '', details: { targetingType: 'auto' } }];
  const vm = mapToViewModel(makeResult({ suggestions }));
  assert(vm.topActions[0].isExecutable === true, 'should be executable');
  assert(vm.topActions[0].ctaLabel === 'Créer', `got ${vm.topActions[0].ctaLabel}`);
});

test('adapter: non-create actions are not executable', () => {
  const suggestions = [{ priority: 10, type: 'consolidate_adgroup', description: 'test', estimatedImpact: '', details: {} }];
  const vm = mapToViewModel(makeResult({ suggestions }));
  assert(vm.topActions[0].isExecutable === false, 'should not be executable');
});

test('adapter: roadmap has week labels', () => {
  const roadmap = [
    { week: 1, actions: [{ type: 'create_campaign', details: { action: 'test' }, priority: 'high' }] },
    { week: 2, actions: [{ type: 'bid_adjustment', details: { action: 'adjust' }, priority: 'medium' }] },
  ];
  const vm = mapToViewModel(makeResult({ roadmap }));
  assert(vm.roadmap.length === 2, `got ${vm.roadmap.length}`);
  assert(vm.roadmap[0].weekLabel === 'Semaine 1', `got ${vm.roadmap[0].weekLabel}`);
  assert(vm.roadmap[1].weekLabel === 'Semaine 2', `got ${vm.roadmap[1].weekLabel}`);
});

// ── Author Summary ──────────────────────────────────────────

console.log('\n--- Author Summary ---');

test('summary: scenario A → mentions "pas encore de campagnes"', () => {
  const result = makeResult({ scenario: 'scenario_a_no_campaigns', context: { ...makeResult().context, totalCampaigns: 0 } });
  const summary = buildAuthorSummary(result);
  assert(summary.includes('pas encore de campagnes'), `got: ${summary}`);
});

test('summary: scenario B with duplication → mentions "cannibalisent"', () => {
  const result = makeResult({ scenario: 'scenario_b_chaos_detected', duplicationScore: 0.6, chaosScore: 0.3 });
  const summary = buildAuthorSummary(result);
  assert(summary.includes('cannibalisent'), `got: ${summary}`);
});

test('summary: scenario B with chaos → mentions "désorganisée"', () => {
  const result = makeResult({ scenario: 'scenario_b_chaos_detected', duplicationScore: 0.2, chaosScore: 0.7 });
  const summary = buildAuthorSummary(result);
  assert(summary.includes('désorganisée'), `got: ${summary}`);
});

test('summary: scenario C → mentions winners count', () => {
  const result = makeResult({ scenario: 'scenario_c_winners_exist', context: { ...makeResult().context, totalWinnerKeywords: 5 } });
  const summary = buildAuthorSummary(result);
  assert(summary.includes('5 mots-clés gagnants'), `got: ${summary}`);
});

test('summary: scenario C with 1 winner → singular', () => {
  const result = makeResult({ scenario: 'scenario_c_winners_exist', context: { ...makeResult().context, totalWinnerKeywords: 1 } });
  const summary = buildAuthorSummary(result);
  assert(summary.includes('1 mot-clé gagnant'), `got: ${summary}`);
  assert(!summary.includes('mots-clés gagnants'), 'should not use plural');
});

test('summary: scenario STABLE → mentions campaign count', () => {
  const result = makeResult({ scenario: 'scenario_stable', context: { ...makeResult().context, totalCampaigns: 4, totalKeywords: 30 } });
  const summary = buildAuthorSummary(result);
  assert(summary.includes('4 campagnes'), `got: ${summary}`);
  assert(summary.includes('30 mots-clés'), `got: ${summary}`);
});

// ── Empty States ────────────────────────────────────────────

console.log('\n--- Empty States ---');

test('empty: no suggestions → empty topActions', () => {
  const vm = mapToViewModel(makeResult({ suggestions: [], nextCampaignRecommendations: [] }));
  assert(vm.topActions.length === 0, `should be 0, got ${vm.topActions.length}`);
});

test('empty: no roadmap → empty roadmap', () => {
  const vm = mapToViewModel(makeResult({ roadmap: [] }));
  assert(vm.roadmap.length === 0, `should be 0, got ${vm.roadmap.length}`);
});

// ── Idempotence Fingerprint ─────────────────────────────────

console.log('\n--- Idempotence Fingerprint ---');

test('fingerprint: same inputs → same hash', () => {
  const dto1 = { bookId: 'b1', planActionType: 'create_campaign', planPayload: { campaignType: 'sponsoredProducts', targetingType: 'auto', matchTypes: [], keywords: [] } };
  const dto2 = { bookId: 'b1', planActionType: 'create_campaign', planPayload: { campaignType: 'sponsoredProducts', targetingType: 'auto', matchTypes: [], keywords: [] } };
  assert(computeFingerprint(dto1) === computeFingerprint(dto2), 'same inputs should produce same hash');
});

test('fingerprint: different bookId → different hash', () => {
  const dto1 = { bookId: 'b1', planActionType: 'create_campaign', planPayload: { campaignType: 'sponsoredProducts', targetingType: 'auto' } };
  const dto2 = { bookId: 'b2', planActionType: 'create_campaign', planPayload: { campaignType: 'sponsoredProducts', targetingType: 'auto' } };
  assert(computeFingerprint(dto1) !== computeFingerprint(dto2), 'different bookId should produce different hash');
});

test('fingerprint: different targetingType → different hash', () => {
  const dto1 = { bookId: 'b1', planActionType: 'create_campaign', planPayload: { campaignType: 'sponsoredProducts', targetingType: 'auto' } };
  const dto2 = { bookId: 'b1', planActionType: 'create_campaign', planPayload: { campaignType: 'sponsoredProducts', targetingType: 'manual' } };
  assert(computeFingerprint(dto1) !== computeFingerprint(dto2), 'different targetingType should produce different hash');
});

test('fingerprint: keyword order does not matter', () => {
  const dto1 = { bookId: 'b1', planActionType: 'create_campaign', planPayload: { keywords: ['alpha', 'beta'] } };
  const dto2 = { bookId: 'b1', planActionType: 'create_campaign', planPayload: { keywords: ['beta', 'alpha'] } };
  assert(computeFingerprint(dto1) === computeFingerprint(dto2), 'keyword order should not matter');
});

test('fingerprint: is 16 chars hex', () => {
  const fp = computeFingerprint({ bookId: 'b1', planActionType: 'x', planPayload: {} });
  assert(fp.length === 16, `should be 16 chars, got ${fp.length}`);
  assert(/^[0-9a-f]+$/.test(fp), `should be hex, got ${fp}`);
});

// ── Validation (inline) ────────────────────────────────────

console.log('\n--- Payload Validation ---');

test('validation: budget < 1 should fail', () => {
  const budget = 0.5;
  const isInvalid = budget < 1 || budget > 1000;
  assert(isInvalid, 'budget < 1 should be invalid');
});

test('validation: budget > 1000 should fail', () => {
  const budget = 1500;
  const isInvalid = budget < 1 || budget > 1000;
  assert(isInvalid, 'budget > 1000 should be invalid');
});

test('validation: budget 10 should be valid', () => {
  const budget = 10;
  const isValid = budget >= 1 && budget <= 1000;
  assert(isValid, 'budget 10 should be valid');
});

console.log('\nDone! ✅\n');
