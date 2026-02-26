import {
  resolveDecisionWindow,
  validateAgainstLongWindow,
  applyLifecycleGuardrail,
  classifyActionIntensity,
} from './decision-window';
import type { MetricsByWindow, WindowMetrics } from '@/modules/insights/types';

// ── Helpers ──────────────────────────────────────────────

function makeMetrics(overrides: Partial<WindowMetrics> = {}): WindowMetrics {
  return {
    impressions: 1000,
    clicks: 20,
    spend: 10,
    sales: 30,
    orders: 3,
    units: 3,
    ...overrides,
  };
}

function makeMetricsByWindow(overrides: {
  w7?: Partial<WindowMetrics>;
  w14?: Partial<WindowMetrics>;
  w30?: Partial<WindowMetrics>;
} = {}): MetricsByWindow {
  return {
    window_7d: makeMetrics(overrides.w7),
    window_14d: makeMetrics(overrides.w14),
    window_30d: makeMetrics(overrides.w30),
  };
}

// ── resolveDecisionWindow ────────────────────────────────

describe('resolveDecisionWindow', () => {
  it('launch: choisit 7j quand assez de clics', () => {
    const result = resolveDecisionWindow('launch', makeMetricsByWindow({ w7: { clicks: 20 } }));
    expect(result.chosenWindow).toBe(7);
    expect(result.isObserveMode).toBe(false);
  });

  it('launch: fallback 14j si 7j insuffisant mais 14j OK', () => {
    const result = resolveDecisionWindow('launch', makeMetricsByWindow({
      w7: { clicks: 5 },
      w14: { clicks: 20 },
    }));
    expect(result.chosenWindow).toBe(14);
    expect(result.isObserveMode).toBe(false);
  });

  it('launch: observe mode si aucune fenetre suffisante', () => {
    const result = resolveDecisionWindow('launch', makeMetricsByWindow({
      w7: { clicks: 3 },
      w14: { clicks: 5 },
      w30: { clicks: 8 },
    }));
    expect(result.isObserveMode).toBe(true);
    expect(result.chosenWindow).toBe(7);
  });

  it('evergreen: toujours 30j', () => {
    const result = resolveDecisionWindow('evergreen', makeMetricsByWindow({
      w7: { clicks: 100 },
      w30: { clicks: 100 },
    }));
    expect(result.chosenWindow).toBe(30);
  });

  it('scale: commence a 14j', () => {
    const result = resolveDecisionWindow('scale', makeMetricsByWindow({
      w14: { clicks: 20 },
    }));
    expect(result.chosenWindow).toBe(14);
    expect(result.isObserveMode).toBe(false);
  });
});

// ── validateAgainstLongWindow ─────────────────────────────

describe('validateAgainstLongWindow', () => {
  const breakEvenAcos = 35;

  it('launch: jamais de validation', () => {
    const result = validateAgainstLongWindow(
      'launch',
      makeMetrics({ orders: 0, sales: 0 }),
      makeMetrics({ orders: 5, sales: 50 }),
      'pause',
      breakEvenAcos,
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no_validation_for_launch');
  });

  describe('CAS CRITIQUE: fenetre courte 0 ventes, 30j a des commandes', () => {
    it('scale: downgrade pause quand 30j a des commandes', () => {
      const decisionMetrics = makeMetrics({ clicks: 63, orders: 0, sales: 0, spend: 20 });
      const longMetrics = makeMetrics({ clicks: 150, orders: 6, sales: 60, spend: 30 });

      const result = validateAgainstLongWindow('scale', decisionMetrics, longMetrics, 'pause', breakEvenAcos);

      expect(result.applied).toBe(true);
      expect(result.downgradeLevel).toBe('soft_adjust');
      expect(result.reason).toBe('decision_zero_orders_but_30d_has_orders');
    });

    it('scale: downgrade add_negative quand 30j a des commandes', () => {
      const decisionMetrics = makeMetrics({ clicks: 63, orders: 0, sales: 0, spend: 20 });
      const longMetrics = makeMetrics({ clicks: 150, orders: 6, sales: 60, spend: 30 });

      const result = validateAgainstLongWindow('scale', decisionMetrics, longMetrics, 'add_negative', breakEvenAcos);

      expect(result.applied).toBe(true);
      expect(result.downgradeLevel).toBe('soft_adjust');
      expect(result.reason).toBe('decision_zero_orders_but_30d_has_orders');
    });

    it('scale: downgrade bid_down quand 30j a des commandes', () => {
      const decisionMetrics = makeMetrics({ clicks: 63, orders: 0, sales: 0, spend: 20 });
      const longMetrics = makeMetrics({ clicks: 150, orders: 6, sales: 60, spend: 30 });

      const result = validateAgainstLongWindow('scale', decisionMetrics, longMetrics, 'bid_down', breakEvenAcos);

      expect(result.applied).toBe(true);
      expect(result.downgradeLevel).toBe('soft_adjust');
      expect(result.reason).toBe('decision_zero_orders_but_30d_has_orders');
    });

    it('evergreen: meme protection', () => {
      const decisionMetrics = makeMetrics({ clicks: 40, orders: 0, sales: 0, spend: 15 });
      const longMetrics = makeMetrics({ clicks: 200, orders: 10, sales: 100, spend: 50 });

      const result = validateAgainstLongWindow('evergreen', decisionMetrics, longMetrics, 'pause', breakEvenAcos);

      expect(result.applied).toBe(true);
      expect(result.downgradeLevel).toBe('soft_adjust');
    });

    it('relaunch: protection pour pause et add_negative', () => {
      const decisionMetrics = makeMetrics({ clicks: 30, orders: 0, sales: 0, spend: 10 });
      const longMetrics = makeMetrics({ clicks: 100, orders: 3, sales: 30, spend: 20 });

      const resultPause = validateAgainstLongWindow('relaunch', decisionMetrics, longMetrics, 'pause', breakEvenAcos);
      expect(resultPause.applied).toBe(true);
      expect(resultPause.downgradeLevel).toBe('soft_adjust');
      expect(resultPause.reason).toBe('relaunch_zero_orders_but_30d_has_orders');

      const resultNeg = validateAgainstLongWindow('relaunch', decisionMetrics, longMetrics, 'add_negative', breakEvenAcos);
      expect(resultNeg.applied).toBe(true);
      expect(resultNeg.downgradeLevel).toBe('soft_adjust');
    });
  });

  describe('Comportement existant preserve', () => {
    it('scale: les deux fenetres ont 0 commandes -> action confirmee', () => {
      const decisionMetrics = makeMetrics({ clicks: 30, orders: 0, sales: 0, spend: 10 });
      const longMetrics = makeMetrics({ clicks: 100, orders: 0, sales: 0, spend: 50 });

      const result = validateAgainstLongWindow('scale', decisionMetrics, longMetrics, 'pause', breakEvenAcos);

      expect(result.applied).toBe(false);
      expect(result.reason).toBe('both_windows_bad_action_confirmed');
    });

    it('scale: action non-forte + decision mauvaise + 30j mauvais -> confirme', () => {
      const decisionMetrics = makeMetrics({ clicks: 30, orders: 0, sales: 0, spend: 10 });
      const longMetrics = makeMetrics({ clicks: 100, orders: 2, sales: 20, spend: 50 });

      const result = validateAgainstLongWindow('scale', decisionMetrics, longMetrics, 'monitor', breakEvenAcos);

      expect(result.applied).toBe(false);
      expect(result.reason).toBe('both_windows_bad_action_confirmed');
    });

    it('scale: decision bonne + 30j mauvais -> observe', () => {
      const decisionMetrics = makeMetrics({ clicks: 20, orders: 5, sales: 100, spend: 20 });
      const longMetrics = makeMetrics({ clicks: 100, orders: 8, sales: 50, spend: 30 });

      const result = validateAgainstLongWindow('scale', decisionMetrics, longMetrics, 'bid_up', breakEvenAcos);

      expect(result.applied).toBe(true);
      expect(result.downgradeLevel).toBe('observe');
    });
  });
});

// ── classifyActionIntensity ─────────────────────────────

describe('classifyActionIntensity', () => {
  it('pause et add_negative sont strong', () => {
    expect(classifyActionIntensity('pause')).toBe('strong');
    expect(classifyActionIntensity('add_negative')).toBe('strong');
  });

  it('bid_down et bid_up sont soft', () => {
    expect(classifyActionIntensity('bid_down')).toBe('soft');
    expect(classifyActionIntensity('bid_up')).toBe('soft');
  });

  it('monitor est observe', () => {
    expect(classifyActionIntensity('monitor')).toBe('observe');
  });
});

// ── applyLifecycleGuardrail ─────────────────────────────

describe('applyLifecycleGuardrail', () => {
  it('launch: pas de strong en < 30j', () => {
    const result = applyLifecycleGuardrail('pause', 'launch', 7);
    expect(result.applied).toBe(true);
    expect(result.downgradeLevel).toBe('soft_adjust');
  });

  it('launch: strong autorise a 30j', () => {
    const result = applyLifecycleGuardrail('pause', 'launch', 30);
    expect(result.applied).toBe(false);
  });

  it('actions non-strong ne sont jamais bloquees', () => {
    const result = applyLifecycleGuardrail('monitor', 'launch', 7);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('action_not_strong');
  });
});
