/**
 * Tests E2E mock — CreateFromPlanService
 *
 * 1. Happy path: create → success → action_log écrit → idempotence bloque le 2e appel
 * 2. 429 rate limit: message clair + pas de DB + pas de state incohérent
 * 3. Partial failure: campaign ok + ad group fail → compensation log
 * 4. Token expired (401): message explicite
 * 5. Duplicate prevention: 2 campagnes Auto pour le même livre → ConflictException
 * 6. Lock prevention: double-click → ConflictException
 * 7. Lifecycle guards: budget capped per lifecycle
 * 8. Fingerprint stability: same input → same hash
 */

const assert = require('assert');
const { createHash } = require('crypto');

// ── Mock factories ──────────────────────────────────────────────

function createMockDb() {
  const store = {
    books: [],
    campaigns: [],
    adGroups: [],
    keywords: [],
    campaignBookMapping: [],
    actionLog: [],
    marketplaceProfiles: [],
    adAccounts: [],
  };

  // Fluent query builder mock
  function createQueryBuilder(tableName) {
    let _where = null;
    let _limit = null;
    let _values = null;
    let _joinTable = null;
    let _joinCond = null;

    const builder = {
      select: (cols) => builder,
      from: (table) => builder,
      where: (cond) => { _where = cond; return builder; },
      limit: (n) => { _limit = n; return builder; },
      innerJoin: (table, cond) => { _joinTable = table; _joinCond = cond; return builder; },
      values: (v) => { _values = v; return builder; },
      onConflictDoNothing: () => builder,
      returning: () => {
        // For inserts that need returning
        if (_values && tableName === 'campaigns') {
          const entry = { id: `camp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...(_values || {}) };
          store.campaigns.push(entry);
          return [entry];
        }
        if (_values && tableName === 'adGroups') {
          const entry = { id: `ag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...(_values || {}) };
          store.adGroups.push(entry);
          return [entry];
        }
        return [_values];
      },
      then: (resolve) => {
        // For select queries that return arrays
        if (tableName === 'books') {
          return resolve(store.books);
        }
        if (tableName === 'actionLog') {
          const matching = store.actionLog.filter(entry => {
            // Simple mock filter
            return true;
          });
          return resolve(matching);
        }
        if (tableName === 'campaignBookMapping') {
          return resolve(store.campaignBookMapping);
        }
        if (tableName === 'campaigns') {
          return resolve(store.campaigns);
        }
        if (tableName === 'marketplaceProfiles') {
          return resolve(store.marketplaceProfiles);
        }
        if (tableName === 'adAccounts') {
          return resolve(store.adAccounts);
        }
        return resolve([]);
      },
    };
    return builder;
  }

  return {
    store,
    select: (cols) => ({
      from: (table) => createQueryBuilder(table._name || 'unknown'),
    }),
    insert: (table) => ({
      values: (v) => {
        const tableName = table._name || 'unknown';
        if (tableName === 'actionLog') {
          store.actionLog.push(v);
          return { onConflictDoNothing: () => ({ returning: () => [v] }) };
        }
        if (tableName === 'campaignBookMapping') {
          store.campaignBookMapping.push(v);
          return { onConflictDoNothing: () => ({ returning: () => [v] }) };
        }
        if (tableName === 'keywords') {
          if (Array.isArray(v)) store.keywords.push(...v);
          else store.keywords.push(v);
          return { onConflictDoNothing: () => ({}) };
        }
        return createQueryBuilder(tableName);
      },
    }),
  };
}

function createMockAmazonClient(options = {}) {
  const { failAt, failStatus, failMessage } = options;

  return {
    createApiClient: async () => ({
      post: async (path, payload) => {
        // Check if we should fail at this step
        if (failAt === path) {
          const err = new Error(failMessage || 'Mock API Error');
          err.response = { status: failStatus || 500, data: { message: failMessage } };
          if (failStatus === 429) {
            err.response.data.message = 'Too many requests';
          }
          throw err;
        }

        if (path === '/sp/campaigns') {
          return { data: { campaigns: { success: [{ campaignId: 12345 }] } } };
        }
        if (path === '/sp/adGroups') {
          return { data: { adGroups: { success: [{ adGroupId: 67890 }] } } };
        }
        if (path === '/sp/keywords') {
          return { data: { keywords: { success: payload.keywords.map((k, i) => ({ keywordId: 100 + i })) } } };
        }
        return { data: {} };
      },
    }),
  };
}

// ── Fingerprint function (matching service logic) ───────────────

function computeFingerprint(dto) {
  const data = JSON.stringify({
    workspaceId: dto.workspaceId,
    bookId: dto.bookId,
    lifecyclePhase: dto.lifecyclePhase || 'launch',
    planActionType: dto.planActionType,
    campaignType: dto.planPayload.campaignType || 'sponsoredProducts',
    targetingType: dto.planPayload.targetingType || 'auto',
    matchTypes: (dto.planPayload.matchTypes || []).slice().sort(),
    keywords: (dto.planPayload.keywords || []).map(k => k.trim().toLowerCase()).sort(),
    asins: (dto.planPayload.asins || []).map(a => a.trim().toUpperCase()).sort(),
    strategicPeriodDays: dto.strategicPeriodDays || 30,
  });
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

// ── Simulated CreateFromPlanService (standalone for testing) ────

class TestableCreateFromPlanService {
  constructor(db, amazonClient) {
    this.db = db;
    this.amazonClient = amazonClient;
    this.pendingLocks = new Map();
  }

  async createCampaignFromPlan(dto) {
    // Validate
    if (!dto.workspaceId) throw { status: 400, message: 'workspaceId requis' };
    if (!dto.bookId) throw { status: 400, message: 'bookId requis' };
    if (!dto.planActionType) throw { status: 400, message: 'planActionType requis' };

    const budget = dto.planPayload?.dailyBudget;
    if (budget !== undefined && (budget < 1 || budget > 1000)) {
      throw { status: 400, message: 'Le budget journalier doit être entre 1€ et 1000€' };
    }

    // Lifecycle guard
    const lifecycleMaxBudgets = { launch: 15, scale: 30, evergreen: 50, relaunch: 25 };
    const lifecycle = dto.lifecyclePhase || 'launch';
    const maxBudget = lifecycleMaxBudgets[lifecycle] || 15;
    if (dto.planPayload.dailyBudget > maxBudget) {
      dto.planPayload.dailyBudget = maxBudget;
    }

    // Fingerprint
    const fingerprint = computeFingerprint(dto);

    // Idempotence check
    const existing = this.db.store.actionLog.find(
      a => a.entityKey === `fingerprint:${fingerprint}` && a.status === 'success'
    );
    if (existing) {
      return {
        success: true,
        campaignName: existing.afterValue?.campaignName || 'Already created',
        fingerprint,
        message: 'Campagne déjà créée — pas de doublon.',
        alreadyCreated: true,
      };
    }

    // Lock check
    if (this.pendingLocks.has(fingerprint)) {
      throw { status: 409, message: 'Une création est déjà en cours pour cette campagne.' };
    }

    // Duplicate auto campaign check
    if (dto.planPayload.targetingType === 'auto') {
      const hasAutoForBook = this.db.store.campaigns.some(
        c => c.targetingType === 'auto' && c.state === 'enabled' && c._bookId === dto.bookId
      );
      if (hasAutoForBook) {
        throw { status: 409, message: 'Une campagne Auto existe déjà pour ce livre.' };
      }
    }

    this.pendingLocks.set(fingerprint, Date.now());
    const compensation = [];

    try {
      const client = await this.amazonClient.createApiClient();

      // Create campaign
      let amazonCampaignId;
      try {
        const resp = await client.post('/sp/campaigns', {});
        amazonCampaignId = resp.data.campaigns?.success?.[0]?.campaignId || resp.data.campaignId;
        compensation.push({ step: 'campaign', amazonId: amazonCampaignId, status: 'created' });
      } catch (err) {
        const code = this.classifyError(err);
        this.db.store.actionLog.push({
          entityKey: `fingerprint:${fingerprint}`,
          actionType: 'create_from_plan',
          status: 'failed',
          errorMessage: code.message,
          afterValue: { compensation },
        });
        throw { status: err.response?.status || 500, message: code.message, code: code.code };
      }

      // Create ad group
      let amazonAdGroupId;
      try {
        const resp = await client.post('/sp/adGroups', {});
        amazonAdGroupId = resp.data.adGroups?.success?.[0]?.adGroupId || resp.data.adGroupId;
        compensation.push({ step: 'ad_group', amazonId: amazonAdGroupId, status: 'created' });
      } catch (err) {
        const code = this.classifyError(err);
        compensation.push({ step: 'ad_group', status: 'failed', error: code.message });
        this.db.store.actionLog.push({
          entityKey: `fingerprint:${fingerprint}`,
          actionType: 'create_from_plan',
          status: 'failed',
          errorMessage: `Partial: campaign created (${amazonCampaignId}), ad group failed`,
          afterValue: { amazonCampaignId, compensation },
        });
        throw {
          status: 400,
          message: `La campagne a été créée (ID: ${amazonCampaignId}) mais le groupe d'annonces a échoué.`,
          partial: true,
          amazonCampaignId,
        };
      }

      // Create keywords
      let keywordsCreated = 0;
      if (dto.planPayload.targetingType === 'manual' && dto.planPayload.keywords?.length) {
        try {
          await client.post('/sp/keywords', { keywords: dto.planPayload.keywords });
          keywordsCreated = dto.planPayload.keywords.length;
          compensation.push({ step: 'keywords', status: 'created' });
        } catch (err) {
          compensation.push({ step: 'keywords', status: 'failed' });
          // Non-blocking
        }
      }

      // Save to DB
      const dbCampaignId = `camp-${Date.now()}`;
      this.db.store.campaigns.push({
        id: dbCampaignId,
        amazonCampaignId,
        name: `Test-SP-Auto`,
        state: 'enabled',
        targetingType: dto.planPayload.targetingType || 'auto',
        _bookId: dto.bookId,
      });

      // Log success
      this.db.store.actionLog.push({
        workspaceId: dto.workspaceId,
        entityKey: `fingerprint:${fingerprint}`,
        actionType: 'create_from_plan',
        status: 'success',
        afterValue: {
          campaignName: 'Test-SP-Auto',
          amazonCampaignId,
          dbCampaignId,
          fingerprint,
          compensation,
        },
      });

      return {
        success: true,
        campaignName: 'Test-SP-Auto',
        amazonCampaignId,
        amazonAdGroupId,
        dbCampaignId,
        keywordsCreated,
        fingerprint,
        message: 'Campagne créée avec succès',
      };
    } finally {
      this.pendingLocks.delete(fingerprint);
    }
  }

  classifyError(err) {
    const status = err?.response?.status;
    if (status === 401 || status === 403) {
      return { code: 'TOKEN_EXPIRED', message: `Authentification expirée (${status}). Reconnectez votre compte.` };
    }
    if (status === 429) {
      return { code: 'RATE_LIMITED', message: 'Amazon Ads est temporairement surchargé (rate limit). Réessayez dans quelques minutes.' };
    }
    if (err?.code === 'ECONNABORTED' || err?.message?.includes('timeout')) {
      return { code: 'TIMEOUT', message: 'La requête Amazon Ads a expiré.' };
    }
    return { code: 'UNKNOWN', message: err?.message || 'Erreur inconnue' };
  }
}

// ── Test Runner ─────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message || err}`);
    failed++;
  }
}

// ── Base DTO ────────────────────────────────────────────────────

const baseDto = {
  workspaceId: 'ws-001',
  bookId: 'book-001',
  planActionType: 'create_campaign',
  planPayload: {
    campaignType: 'sponsoredProducts',
    targetingType: 'auto',
    dailyBudget: 10,
  },
  lifecyclePhase: 'launch',
};

// ══════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════

(async () => {
  console.log('\n🔬 CreateFromPlan E2E Tests (mock)\n');

  // ── 1. Happy Path ──────────────────────────────────
  console.log('--- Happy Path ---');

  await test('happy path: create campaign → success', async () => {
    const db = createMockDb();
    const amazon = createMockAmazonClient();
    const svc = new TestableCreateFromPlanService(db, amazon);

    const result = await svc.createCampaignFromPlan({ ...baseDto });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.amazonCampaignId, 12345);
    assert.strictEqual(result.amazonAdGroupId, 67890);
    assert.ok(result.fingerprint);
    assert.ok(result.dbCampaignId);
    assert.strictEqual(result.message, 'Campagne créée avec succès');
  });

  await test('happy path: action_log written on success', async () => {
    const db = createMockDb();
    const amazon = createMockAmazonClient();
    const svc = new TestableCreateFromPlanService(db, amazon);

    await svc.createCampaignFromPlan({ ...baseDto });

    const logs = db.store.actionLog.filter(l => l.status === 'success');
    assert.strictEqual(logs.length, 1);
    assert.ok(logs[0].entityKey.startsWith('fingerprint:'));
    assert.strictEqual(logs[0].afterValue.amazonCampaignId, 12345);
    assert.ok(logs[0].afterValue.compensation.length >= 2);
  });

  await test('happy path: idempotence blocks second call', async () => {
    const db = createMockDb();
    const amazon = createMockAmazonClient();
    const svc = new TestableCreateFromPlanService(db, amazon);

    const first = await svc.createCampaignFromPlan({ ...baseDto });
    const second = await svc.createCampaignFromPlan({ ...baseDto });

    assert.strictEqual(second.alreadyCreated, true);
    assert.ok(second.message.includes('déjà créée'));
    // Should NOT create a second campaign in DB
    const successLogs = db.store.actionLog.filter(l => l.status === 'success');
    assert.strictEqual(successLogs.length, 1);
  });

  // ── 2. Rate Limit (429) ─────────────────────────────
  console.log('\n--- Rate Limit (429) ---');

  await test('429 on campaign create: clear message + no DB save', async () => {
    const db = createMockDb();
    const amazon = createMockAmazonClient({ failAt: '/sp/campaigns', failStatus: 429 });
    const svc = new TestableCreateFromPlanService(db, amazon);

    try {
      await svc.createCampaignFromPlan({ ...baseDto });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('rate limit') || err.message.includes('surchargé'));
      assert.strictEqual(err.code, 'RATE_LIMITED');
    }

    // No campaign should be in DB
    assert.strictEqual(db.store.campaigns.length, 0);

    // Action log should record failure
    const failLogs = db.store.actionLog.filter(l => l.status === 'failed');
    assert.strictEqual(failLogs.length, 1);
  });

  await test('429 on ad group: partial failure logged', async () => {
    const db = createMockDb();
    const amazon = createMockAmazonClient({ failAt: '/sp/adGroups', failStatus: 429 });
    const svc = new TestableCreateFromPlanService(db, amazon);

    try {
      await svc.createCampaignFromPlan({ ...baseDto });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.partial === true);
      assert.ok(err.amazonCampaignId === 12345);
    }

    // Failure log should exist with partial info
    const failLogs = db.store.actionLog.filter(l => l.status === 'failed');
    assert.strictEqual(failLogs.length, 1);
    assert.ok(failLogs[0].afterValue.amazonCampaignId === 12345);
    assert.ok(failLogs[0].afterValue.compensation.some(c => c.step === 'ad_group' && c.status === 'failed'));
  });

  // ── 3. Token Expired (401) ──────────────────────────
  console.log('\n--- Token Expired (401) ---');

  await test('401 on campaign create: explicit reconnect message', async () => {
    const db = createMockDb();
    const amazon = createMockAmazonClient({ failAt: '/sp/campaigns', failStatus: 401 });
    const svc = new TestableCreateFromPlanService(db, amazon);

    try {
      await svc.createCampaignFromPlan({ ...baseDto });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('Authentification') || err.message.includes('Reconnectez'));
      assert.strictEqual(err.code, 'TOKEN_EXPIRED');
      assert.strictEqual(db.store.campaigns.length, 0);
    }
  });

  // ── 4. Duplicate Prevention ─────────────────────────
  console.log('\n--- Duplicate Prevention ---');

  await test('second auto campaign for same book → ConflictException', async () => {
    const db = createMockDb();
    // Pre-seed an existing auto campaign for this book
    db.store.campaigns.push({
      id: 'existing-camp',
      targetingType: 'auto',
      state: 'enabled',
      _bookId: 'book-001',
    });

    const amazon = createMockAmazonClient();
    const svc = new TestableCreateFromPlanService(db, amazon);

    try {
      await svc.createCampaignFromPlan({ ...baseDto });
      assert.fail('Should have thrown ConflictException');
    } catch (err) {
      assert.strictEqual(err.status, 409);
      assert.ok(err.message.includes('Auto existe déjà'));
    }
  });

  // ── 5. Lock Prevention ──────────────────────────────
  console.log('\n--- Lock Prevention ---');

  await test('double-click prevention: concurrent calls blocked', async () => {
    const db = createMockDb();
    // Create a slow Amazon client
    const slowAmazon = {
      createApiClient: async () => ({
        post: async (path) => {
          await new Promise(r => setTimeout(r, 100)); // simulate slow
          if (path === '/sp/campaigns') return { data: { campaigns: { success: [{ campaignId: 99999 }] } } };
          if (path === '/sp/adGroups') return { data: { adGroups: { success: [{ adGroupId: 88888 }] } } };
          return { data: {} };
        },
      }),
    };
    const svc = new TestableCreateFromPlanService(db, slowAmazon);

    // Start first call (don't await)
    const first = svc.createCampaignFromPlan({ ...baseDto });

    // Small delay then second call
    await new Promise(r => setTimeout(r, 10));

    try {
      await svc.createCampaignFromPlan({ ...baseDto });
      assert.fail('Second call should be blocked');
    } catch (err) {
      assert.strictEqual(err.status, 409);
      assert.ok(err.message.includes('déjà en cours'));
    }

    // Wait for first to complete
    const result = await first;
    assert.strictEqual(result.success, true);
  });

  // ── 6. Lifecycle Guards ─────────────────────────────
  console.log('\n--- Lifecycle Guards ---');

  await test('budget capped at lifecycle max (launch: 15€)', async () => {
    const db = createMockDb();
    const amazon = createMockAmazonClient();
    const svc = new TestableCreateFromPlanService(db, amazon);

    const dto = {
      ...baseDto,
      planPayload: { ...baseDto.planPayload, dailyBudget: 50 },
      lifecyclePhase: 'launch',
    };

    const result = await svc.createCampaignFromPlan(dto);
    assert.strictEqual(result.success, true);
    // Budget should have been capped — check via the DTO mutation
    assert.strictEqual(dto.planPayload.dailyBudget, 15);
  });

  await test('budget capped at lifecycle max (scale: 30€)', async () => {
    const db = createMockDb();
    const amazon = createMockAmazonClient();
    const svc = new TestableCreateFromPlanService(db, amazon);

    const dto = {
      workspaceId: 'ws-002',
      bookId: 'book-002',
      planActionType: 'create_campaign',
      planPayload: { campaignType: 'sponsoredProducts', targetingType: 'auto', dailyBudget: 100 },
      lifecyclePhase: 'scale',
    };

    await svc.createCampaignFromPlan(dto);
    assert.strictEqual(dto.planPayload.dailyBudget, 30);
  });

  // ── 7. Fingerprint Stability ────────────────────────
  console.log('\n--- Fingerprint Stability ---');

  await test('same input → same fingerprint (deterministic)', () => {
    const fp1 = computeFingerprint(baseDto);
    const fp2 = computeFingerprint(baseDto);
    assert.strictEqual(fp1, fp2);
  });

  await test('fingerprint includes lifecyclePhase', () => {
    const fp1 = computeFingerprint({ ...baseDto, lifecyclePhase: 'launch' });
    const fp2 = computeFingerprint({ ...baseDto, lifecyclePhase: 'scale' });
    assert.notStrictEqual(fp1, fp2);
  });

  await test('fingerprint includes workspaceId', () => {
    const fp1 = computeFingerprint({ ...baseDto, workspaceId: 'ws-001' });
    const fp2 = computeFingerprint({ ...baseDto, workspaceId: 'ws-002' });
    assert.notStrictEqual(fp1, fp2);
  });

  await test('fingerprint normalizes keywords (lowercase, sorted, trimmed)', () => {
    const dto1 = {
      ...baseDto,
      planPayload: { ...baseDto.planPayload, keywords: ['Thriller', '  roman policier  '] },
    };
    const dto2 = {
      ...baseDto,
      planPayload: { ...baseDto.planPayload, keywords: ['roman policier', 'thriller'] },
    };
    const fp1 = computeFingerprint(dto1);
    const fp2 = computeFingerprint(dto2);
    assert.strictEqual(fp1, fp2);
  });

  await test('fingerprint includes strategicPeriodDays', () => {
    const fp1 = computeFingerprint({ ...baseDto, strategicPeriodDays: 30 });
    const fp2 = computeFingerprint({ ...baseDto, strategicPeriodDays: 60 });
    assert.notStrictEqual(fp1, fp2);
  });

  // ── 8. Validation ───────────────────────────────────
  console.log('\n--- Validation ---');

  await test('missing workspaceId → error', async () => {
    const svc = new TestableCreateFromPlanService(createMockDb(), createMockAmazonClient());
    try {
      await svc.createCampaignFromPlan({ ...baseDto, workspaceId: '' });
      assert.fail('Should throw');
    } catch (err) {
      assert.ok(err.message.includes('workspaceId'));
    }
  });

  await test('budget < 1 → error', async () => {
    const svc = new TestableCreateFromPlanService(createMockDb(), createMockAmazonClient());
    try {
      await svc.createCampaignFromPlan({
        ...baseDto,
        planPayload: { ...baseDto.planPayload, dailyBudget: 0.5 },
      });
      assert.fail('Should throw');
    } catch (err) {
      assert.ok(err.message.includes('budget'));
    }
  });

  await test('budget > 1000 → error', async () => {
    const svc = new TestableCreateFromPlanService(createMockDb(), createMockAmazonClient());
    try {
      await svc.createCampaignFromPlan({
        ...baseDto,
        planPayload: { ...baseDto.planPayload, dailyBudget: 1500 },
      });
      assert.fail('Should throw');
    } catch (err) {
      assert.ok(err.message.includes('budget'));
    }
  });

  // ── 9. Compensation Log ─────────────────────────────
  console.log('\n--- Compensation Log ---');

  await test('partial failure includes compensation entries', async () => {
    const db = createMockDb();
    const amazon = createMockAmazonClient({ failAt: '/sp/adGroups', failStatus: 500, failMessage: 'Internal Server Error' });
    const svc = new TestableCreateFromPlanService(db, amazon);

    try {
      await svc.createCampaignFromPlan({ ...baseDto });
    } catch (_) {}

    const failLog = db.store.actionLog.find(l => l.status === 'failed');
    assert.ok(failLog);
    assert.ok(failLog.afterValue.compensation);
    assert.ok(failLog.afterValue.compensation.some(c => c.step === 'campaign' && c.status === 'created'));
    assert.ok(failLog.afterValue.compensation.some(c => c.step === 'ad_group' && c.status === 'failed'));
  });

  await test('keyword failure is non-blocking, compensation logged', async () => {
    const db = createMockDb();
    const amazon = createMockAmazonClient({ failAt: '/sp/keywords', failStatus: 500 });
    const svc = new TestableCreateFromPlanService(db, amazon);

    const dto = {
      ...baseDto,
      planPayload: {
        campaignType: 'sponsoredProducts',
        targetingType: 'manual',
        matchTypes: ['exact'],
        dailyBudget: 10,
        keywords: ['thriller', 'roman'],
      },
    };

    const result = await svc.createCampaignFromPlan(dto);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.keywordsCreated, 0);

    const successLog = db.store.actionLog.find(l => l.status === 'success');
    assert.ok(successLog.afterValue.compensation.some(c => c.step === 'keywords' && c.status === 'failed'));
  });

  // ── Summary ─────────────────────────────────────────
  console.log(`\nDone! ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
