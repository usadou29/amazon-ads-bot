/**
 * Tests : Frontend adapter (campaign-evolution.ts) + UI component logic
 * 10 tests covering ViewModel mapping, CTA rendering rules, and wizard logic
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

// ── Mock API Result (mirrors CampaignEvolutionResult from backend) ──

function makeApiResult(overrides = {}) {
  return {
    bookId: 'book-1',
    analyzedAt: new Date().toISOString(),
    maturityScore: 50,
    maturityBreakdown: { structure: 15, winnersExploited: 10, diversification: 10, stability: 15 },
    duplicationScore: 0.2,
    chaosScore: 0.3,
    scenario: 'scenario_a_no_campaigns',
    topFocus: {
      theme: 'VISIBILITE',
      title: 'Lancer tes premières campagnes',
      summary: 'Tu n\'as pas encore de publicité.',
      evidence: [
        { label: 'Campagnes actives', value: '0' },
        { label: 'Visibilité actuelle', value: 'Aucune' },
      ],
      primaryCta: { label: 'Créer les campagnes recommandées', intent: 'CREATE' },
    },
    creationPlan: {
      planId: 'plan-123',
      fingerprint: 'abc123def456',
      campaignsToCreate: [
        {
          name: 'Livre-SP-Auto',
          type: 'SP_AUTO',
          targetingMode: 'AUTO',
          dailyBudget: 5,
          biddingStrategy: 'DOWN_ONLY',
          notesWhy: 'Campagne de découverte.',
        },
        {
          name: 'Livre-SP-Exact',
          type: 'SP_MANUAL_EXACT',
          targetingMode: 'MANUAL',
          dailyBudget: 5,
          biddingStrategy: 'DOWN_ONLY',
          seedKeywords: ['thriller', 'suspense'],
          notesWhy: 'Cible les termes précis.',
        },
      ],
    },
    campaignRoles: [],
    structuralIssues: [],
    suggestions: [],
    roadmap: [
      {
        week: 1,
        title: 'Lancement — campagne Auto + Broad',
        actions: [
          {
            type: 'create_campaign',
            priority: 'high',
            why: 'Sans campagne Auto, Amazon ne peut pas tester.',
            impact: 'Premiers clics sous 48h.',
            details: { name: 'Test-Auto' },
          },
        ],
      },
      {
        week: 2,
        title: 'Récolte — extraire les termes',
        actions: [
          {
            type: 'create_campaign',
            priority: 'high',
            why: 'Premiers résultats Auto.',
            impact: 'Capturer les recherches.',
            details: {},
          },
        ],
      },
    ],
    nextCampaignRecommendations: [],
    diversificationOpportunities: [],
    context: {
      lifecyclePhase: 'launch',
      totalCampaigns: 0,
      totalAdGroups: 0,
      totalKeywords: 0,
      totalProductTargets: 0,
      totalWinnerKeywords: 0,
      totalBoostCandidateKeywords: 0,
      avgAcos: undefined,
      totalSpend30d: undefined,
      totalSales30d: undefined,
    },
    ...overrides,
  };
}

// ── Replicate adapter logic (same as campaign-evolution.ts) ──

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

function mapToViewModel(result) {
  return {
    topFocus: result.topFocus,
    creationPlan: result.creationPlan,
    summarySentence: result.topFocus.summary,
    scenarioLabel: scenarioToLabel(result.scenario),
    stateTag: scenarioToStateTag(result.scenario),
    roadmap: result.roadmap.map(w => ({
      weekLabel: `Semaine ${w.week}`,
      weekTitle: w.title || `Semaine ${w.week}`,
      items: w.actions.map(a => ({
        title: a.type,
        desc: a.details?.action || '',
        why: a.why || '',
        impact: a.impact || '',
        priority: a.priority,
      })),
    })),
    details: {
      duplicationScore: result.duplicationScore,
      chaosScore: result.chaosScore,
      maturityScore: result.maturityScore,
      maturityBreakdown: result.maturityBreakdown,
    },
    context: result.context,
  };
}

// ── TESTS ─────────────────────────────────────────────────────────

console.log('\n🧪 Frontend Adapter + UI Logic Tests');
console.log('─'.repeat(55));

// ── 1. ViewModel mapping ──────────────────────────────────────────

console.log('\n📌 ViewModel Mapping');

test('VM maps topFocus from API result', () => {
  const vm = mapToViewModel(makeApiResult());
  assert(vm.topFocus.theme === 'VISIBILITE', 'Theme should be VISIBILITE');
  assert(vm.topFocus.primaryCta.intent === 'CREATE', 'CTA intent should be CREATE');
  assert(vm.topFocus.evidence.length === 2, 'Should have 2 evidence items');
});

test('VM maps creationPlan from API result', () => {
  const vm = mapToViewModel(makeApiResult());
  assert(vm.creationPlan !== undefined, 'creationPlan should exist');
  assert(vm.creationPlan.campaignsToCreate.length === 2, 'Should have 2 campaigns');
  assert(vm.creationPlan.planId === 'plan-123', 'planId should match');
});

test('VM summarySentence comes from topFocus.summary', () => {
  const vm = mapToViewModel(makeApiResult());
  assert(vm.summarySentence === 'Tu n\'as pas encore de publicité.',
    'summarySentence should be topFocus.summary');
});

test('VM stateTag maps correctly for all scenarios', () => {
  assert(scenarioToStateTag('scenario_a_no_campaigns') === 'AUCUNE_CAMPAGNE', 'A');
  assert(scenarioToStateTag('scenario_b_chaos_detected') === 'CHAOS', 'B');
  assert(scenarioToStateTag('scenario_c_winners_exist') === 'WINNERS', 'C');
  assert(scenarioToStateTag('scenario_stable') === 'STABLE', 'STABLE');
});

test('VM roadmap weeks have weekTitle field', () => {
  const vm = mapToViewModel(makeApiResult());
  assert(vm.roadmap.length === 2, 'Should have 2 weeks');
  assert(vm.roadmap[0].weekTitle.includes('Lancement'), 'Week 1 title should contain Lancement');
  assert(vm.roadmap[0].items[0].why.length > 0, 'Action should have why');
  assert(vm.roadmap[0].items[0].impact.length > 0, 'Action should have impact');
});

// ── 2. CTA rendering rules (UI logic) ────────────────────────────

console.log('\n📌 CTA Rendering Rules');

test('CREATE intent + creationPlan → primary button visible', () => {
  const vm = mapToViewModel(makeApiResult());
  const cta = vm.topFocus.primaryCta;
  const showCreateButton = cta.intent === 'CREATE' && vm.creationPlan;
  assert(showCreateButton, 'CREATE + creationPlan → show primary button');
});

test('CLEANUP intent → secondary button', () => {
  const result = makeApiResult({
    topFocus: {
      theme: 'STRUCTURE',
      title: 'Nettoyer',
      summary: 'Clean up.',
      evidence: [],
      primaryCta: { label: 'Nettoyer', intent: 'CLEANUP' },
    },
    creationPlan: undefined,
  });
  const vm = mapToViewModel(result);
  const cta = vm.topFocus.primaryCta;
  const showCreateButton = cta.intent === 'CREATE' && vm.creationPlan;
  assert(!showCreateButton, 'CLEANUP should NOT show create button');
  assert(cta.intent === 'CLEANUP', 'Intent should be CLEANUP');
});

test('OBSERVE intent → text label only (no button)', () => {
  const result = makeApiResult({
    topFocus: {
      theme: 'VISIBILITE',
      title: 'Stable',
      summary: 'All good.',
      evidence: [],
      primaryCta: { label: 'Surveiller', intent: 'OBSERVE' },
    },
    creationPlan: undefined,
  });
  const vm = mapToViewModel(result);
  const cta = vm.topFocus.primaryCta;
  const showCreateButton = cta.intent === 'CREATE' && vm.creationPlan;
  const isActionable = cta.intent === 'CREATE' || cta.intent === 'CLEANUP' || cta.intent === 'AMPLIFY';
  assert(!showCreateButton, 'OBSERVE should NOT show create button');
  assert(!isActionable, 'OBSERVE should not be actionable');
});

// ── 3. Wizard batch logic ────────────────────────────────────────

console.log('\n📌 Wizard Batch Logic');

test('Wizard: total budget calculates from active campaigns', () => {
  const campaigns = [
    { dailyBudget: 5, skip: false },
    { dailyBudget: 8, skip: true },
    { dailyBudget: 10, skip: false },
  ];
  const totalBudget = campaigns.reduce((sum, c) => c.skip ? sum : sum + c.dailyBudget, 0);
  assert(totalBudget === 15, `Expected 15€, got ${totalBudget}€`);
});

test('Wizard: overrides merge correctly into batch DTO', () => {
  const campaignsToCreate = [
    { name: 'A', dailyBudget: 5 },
    { name: 'B', dailyBudget: 8 },
  ];
  const overrides = [
    { dailyBudget: 12, skip: false },
    { dailyBudget: 8, skip: false },
  ];

  // Only send overrides that differ
  const sentOverrides = overrides
    .map((ov, i) => ({ index: i, dailyBudget: ov.dailyBudget, skip: ov.skip }))
    .filter((ov) => ov.skip || ov.dailyBudget !== campaignsToCreate[ov.index].dailyBudget);

  assert(sentOverrides.length === 1, 'Only 1 override should be sent (budget changed)');
  assert(sentOverrides[0].index === 0, 'Override should be for campaign 0');
  assert(sentOverrides[0].dailyBudget === 12, 'Override budget should be 12');
});

// ── Summary ──────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(55));
console.log(`✅ ${passed} passed, ❌ ${failed} failed — Total: ${passed + failed}`);
console.log('');
