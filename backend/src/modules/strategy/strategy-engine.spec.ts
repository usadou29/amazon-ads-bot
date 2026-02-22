import { StrategyEngine, StrategyInput, StrategyContext, StrategyResult } from './strategy-engine';

/**
 * Tests unitaires du Strategy Engine — Logique économique Break-Even ACoS
 *
 * Scénarios testés :
 * 1. Mot-clé rentable (13 cmd, ACoS 32%, royalty 35%) → bid_down recommandé, PAS pause
 * 2. Mot-clé sans commandes (0 cmd, 20 clics) → pause autorisée
 * 3. Mot-clé très rentable (8 cmd, ACoS 20%, royalty 35%) → bid_up/harvest recommandé
 * 4. Mot-clé en exploration (2 cmd, ACoS 60%, royalty 35%) → bid_down recommandé
 * 5. Backward compat : sans strategyContext → fallback 35%
 * 6. Backward compat : sans strategyContext paramètre → même comportement qu'avant
 */
describe('StrategyEngine — Economic Break-Even Logic', () => {
  let engine: StrategyEngine;

  beforeEach(() => {
    engine = new StrategyEngine();
  });

  // Helper pour créer des recos de test
  function makeReco(overrides: Partial<StrategyInput> & { actionType: string }): StrategyInput {
    return {
      id: `reco-${Math.random().toString(36).slice(2, 8)}`,
      entityKey: 'keyword:kw-test-123',
      entityType: 'keyword',
      contextData: {},
      confidenceScore: null,
      ...overrides,
    };
  }

  const defaultContext: StrategyContext = {
    royaltyRate: 35,
    defaultRoyaltyRate: 35,
  };

  // ─── Scénario 1 : Mot-clé rentable en phase Scale ─────────────────
  // 13 commandes, ACoS 32%, royalty 35% → profitRatio = 0.91 (zone optimization)
  // Attendu : bid_down recommandé, pause NON recommandée
  describe('Scénario 1: Mot-clé rentable (13 cmd, ACoS 32%, royalty 35%) en Scale', () => {
    const metrics = { clicks: 150, orders: 13, acos: 32, spend: 48, sales: 150 };

    it('bid_down devrait avoir un score plus élevé que pause', () => {
      const recos = [
        makeReco({
          actionType: 'pause_high_acos',
          contextData: { metrics },
        }),
        makeReco({
          actionType: 'bid_down_no_sales',
          contextData: { metrics },
        }),
      ];

      const results = engine.process(recos, 'scale', defaultContext);
      const pauseResult = results.find(r => r.id === recos[0].id)!;
      const bidDownResult = results.find(r => r.id === recos[1].id)!;

      // bid_down doit scorer plus haut que pause
      expect(bidDownResult.strategyScore).toBeGreaterThan(pauseResult.strategyScore);
      // bid_down doit être recommandé
      expect(bidDownResult.recommendedForLifecycle).toBe(true);
      // pause ne doit PAS être recommandée
      expect(pauseResult.recommendedForLifecycle).toBe(false);
    });

    it('pause devrait avoir un score très bas (hard guard)', () => {
      const recos = [
        makeReco({
          actionType: 'pause_high_acos',
          contextData: { metrics },
        }),
      ];

      const results = engine.process(recos, 'scale', defaultContext);
      // Le hard guard (-60) + zone optimization (-25) + orders>0 (-15) devrait écraser le score
      expect(results[0].strategyScore).toBeLessThan(30);
    });
  });

  // ─── Scénario 2 : Mot-clé sans commandes ──────────────────────────
  // 0 commandes, 20 clics → zone unprofitable
  // Attendu : pause autorisée et peut être recommandée
  describe('Scénario 2: Mot-clé sans commandes (0 cmd, 20 clics) en Scale', () => {
    const metrics = { clicks: 20, orders: 0, acos: 0, spend: 15, sales: 0 };

    it('pause devrait être autorisée (pas de hard guard)', () => {
      const recos = [
        makeReco({
          actionType: 'pause_high_acos',
          contextData: { metrics },
        }),
        makeReco({
          actionType: 'bid_down_no_sales',
          contextData: { metrics },
        }),
      ];

      const results = engine.process(recos, 'scale', defaultContext);
      const pauseResult = results.find(r => r.id === recos[0].id)!;

      // Pause devrait avoir un score raisonnable (base 70 - 10 riskPenalty + contextBonus)
      expect(pauseResult.strategyScore).toBeGreaterThanOrEqual(60);
    });
  });

  // ─── Scénario 3 : Mot-clé très rentable ───────────────────────────
  // 8 commandes, ACoS 20%, royalty 35% → profitRatio = 0.57 (zone profitable)
  // Attendu : bid_up/harvest favorisés, pause BLOQUÉE
  describe('Scénario 3: Mot-clé très rentable (8 cmd, ACoS 20%, royalty 35%) en Scale', () => {
    const metrics = { clicks: 100, orders: 8, acos: 20, spend: 30, sales: 150, cvr: 8 };

    it('pause devrait être fortement bloquée', () => {
      const recos = [
        makeReco({
          actionType: 'pause_high_acos',
          contextData: { metrics },
        }),
      ];

      const results = engine.process(recos, 'scale', defaultContext);
      // Hard guard : orders >= 3 ET acos (20) <= breakEven * 1.2 (42) → -60
      // + zone profitable -30 + orders>0 -15
      expect(results[0].strategyScore).toBeLessThan(15);
      expect(results[0].recommendedForLifecycle).toBe(false);
    });

    it('bid_up et harvest devraient être boostés', () => {
      const recos = [
        makeReco({
          actionType: 'bid_up_high_performer',
          contextData: { metrics },
        }),
        makeReco({
          actionType: 'harvest_profitable_search_term',
          contextData: { metrics },
        }),
      ];

      const results = engine.process(recos, 'scale', defaultContext);
      const bidUpResult = results.find(r => r.id === recos[0].id)!;
      const harvestResult = results.find(r => r.id === recos[1].id)!;

      // bid_up en scale (base 95) + profitable zone (+20) + context bonus
      expect(bidUpResult.strategyScore).toBeGreaterThanOrEqual(90);
      // harvest en scale (base 100) + profitable zone (+15) + context bonus
      expect(harvestResult.strategyScore).toBeGreaterThanOrEqual(90);
    });
  });

  // ─── Scénario 4 : Mot-clé en exploration ──────────────────────────
  // 2 commandes, ACoS 60%, royalty 35% → profitRatio = 1.71 (zone unprofitable)
  // Attendu : bid_down recommandé, pause pénalisée (orders > 0)
  describe('Scénario 4: Mot-clé en exploration (2 cmd, ACoS 60%, royalty 35%) en Scale', () => {
    const metrics = { clicks: 50, orders: 2, acos: 60, spend: 30, sales: 50 };

    it('bid_down devrait être recommandé plutôt que pause', () => {
      const recos = [
        makeReco({
          actionType: 'pause_high_acos',
          contextData: { metrics },
        }),
        makeReco({
          actionType: 'bid_down_no_sales',
          contextData: { metrics },
        }),
      ];

      const results = engine.process(recos, 'scale', defaultContext);
      const pauseResult = results.find(r => r.id === recos[0].id)!;
      const bidDownResult = results.find(r => r.id === recos[1].id)!;

      // bid_down doit scorer plus haut
      expect(bidDownResult.strategyScore).toBeGreaterThan(pauseResult.strategyScore);
      expect(bidDownResult.recommendedForLifecycle).toBe(true);
    });
  });

  // ─── Scénario 5 : Backward compat — sans royaltyRate ──────────────
  describe('Backward compat: sans royaltyRate (fallback 35%)', () => {
    it('devrait utiliser le DEFAULT_ROYALTY_RATE (35%) comme break-even', () => {
      const metrics = { clicks: 150, orders: 13, acos: 32, spend: 48, sales: 150 };
      const contextNoRoyalty: StrategyContext = {
        royaltyRate: undefined,
        defaultRoyaltyRate: 35,
      };

      const recos = [
        makeReco({
          actionType: 'pause_high_acos',
          contextData: { metrics },
        }),
        makeReco({
          actionType: 'bid_down_no_sales',
          contextData: { metrics },
        }),
      ];

      const results = engine.process(recos, 'scale', contextNoRoyalty);
      const pauseResult = results.find(r => r.id === recos[0].id)!;
      const bidDownResult = results.find(r => r.id === recos[1].id)!;

      // Même comportement qu'avec royaltyRate=35 explicite
      expect(bidDownResult.strategyScore).toBeGreaterThan(pauseResult.strategyScore);
      expect(pauseResult.recommendedForLifecycle).toBe(false);
    });
  });

  // ─── Scénario 6 : Backward compat — sans strategyContext ──────────
  describe('Backward compat: sans strategyContext', () => {
    it('devrait fonctionner sans erreur (undefined strategyContext)', () => {
      const metrics = { clicks: 20, orders: 0, acos: 0, spend: 15, sales: 0 };
      const recos = [
        makeReco({
          actionType: 'pause_high_acos',
          contextData: { metrics },
        }),
      ];

      // Appel sans strategyContext — ne doit pas crash
      const results = engine.process(recos, 'scale');
      expect(results).toHaveLength(1);
      expect(results[0].strategyScore).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Phase Launch : patience favorisée ─────────────────────────────
  describe('Phase Launch: patience favorisée sur pause', () => {
    it('devrait favoriser patience sur pause en phase launch', () => {
      const metrics = { clicks: 10, orders: 0, acos: 0, spend: 8, sales: 0 };

      const recos = [
        makeReco({
          actionType: 'pause_high_acos',
          contextData: { metrics },
        }),
        makeReco({
          actionType: 'launch_high_acos_patience',
          contextData: { metrics },
        }),
      ];

      const results = engine.process(recos, 'launch', defaultContext);
      const pauseResult = results.find(r => r.id === recos[0].id)!;
      const patienceResult = results.find(r => r.id === recos[1].id)!;

      expect(patienceResult.strategyScore).toBeGreaterThan(pauseResult.strategyScore);
    });
  });

  // ─── Budget guard still works ──────────────────────────────────────
  describe('Budget guard toujours fonctionnel avec nouveau paramètre', () => {
    it('devrait appliquer le consentement renforcé en launch si budget dépassé', () => {
      const metrics = { clicks: 10, orders: 2, acos: 25, spend: 50, sales: 200 };

      const recos = [
        makeReco({
          actionType: 'bid_up_high_performer',
          contextData: { metrics },
        }),
      ];

      const results = engine.process(
        recos,
        'launch',
        defaultContext,
        { maxSpend7d: 40, currentSpend7d: 50 },
      );

      expect(results[0].requiresConsent).toBe(true);
      expect(results[0].consentLevel).toBe('reinforced');
    });
  });
});
