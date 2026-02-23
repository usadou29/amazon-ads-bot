import { resolveDecisionWindow, validateAgainstLongWindow, applyLifecycleGuardrail, classifyActionIntensity } from './decision-window';
import type { MetricsByWindow, WindowMetrics } from '@/modules/insights/types';

// ── Helpers ────────────────────────────────────────────────

function makeWindowMetrics(overrides: Partial<WindowMetrics> = {}): WindowMetrics {
  return {
    impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, units: 0,
    acos: null, ctr: null, cvr: null,
    ...overrides,
  };
}

function makeMetricsByWindow(
  w7: Partial<WindowMetrics> = {},
  w14: Partial<WindowMetrics> = {},
  w30: Partial<WindowMetrics> = {},
): MetricsByWindow {
  return {
    window_7d: makeWindowMetrics(w7),
    window_14d: makeWindowMetrics(w14),
    window_30d: makeWindowMetrics(w30),
  };
}

// ═══════════════════════════════════════════════════════════
// resolveDecisionWindow
// ═══════════════════════════════════════════════════════════

describe('resolveDecisionWindow', () => {
  // ── Scenario 1: Launch — 7j < 15 clics, 14j < 15 clics, 30j >= 15 clics → choisit 30j ──
  describe('Scenario 1: Launch escalade vers 30j', () => {
    it('should escalate to 30d when only 30d has enough clicks', () => {
      const m = makeMetricsByWindow(
        { clicks: 8, impressions: 100 },
        { clicks: 12, impressions: 200 },
        { clicks: 25, orders: 2, spend: 15, sales: 40, impressions: 500 },
      );

      const result = resolveDecisionWindow('launch', m);

      expect(result.chosenWindow).toBe(30);
      expect(result.isObserveMode).toBe(false);
      expect(result.reason).toBe('clicks_30d_sufficient');
      // Vérifie que les métriques viennent EXACTEMENT de la fenêtre 30j
      expect(result.metricsOnWindow.clicks).toBe(25);
      expect(result.metricsOnWindow.orders).toBe(2);
    });
  });

  // ── Scenario 1b: Launch — 7j >= 15 clics → choisit 7j ──
  describe('Scenario 1b: Launch with sufficient 7d clicks', () => {
    it('should choose 7d when 7d has enough clicks', () => {
      const m = makeMetricsByWindow(
        { clicks: 20, orders: 1, spend: 10, sales: 30, impressions: 200 },
        { clicks: 35, orders: 3, impressions: 400 },
        { clicks: 80, orders: 8, impressions: 1000 },
      );

      const result = resolveDecisionWindow('launch', m);

      expect(result.chosenWindow).toBe(7);
      expect(result.isObserveMode).toBe(false);
      expect(result.reason).toBe('clicks_7d_sufficient');
      expect(result.metricsOnWindow.clicks).toBe(20);
    });
  });

  // ── Scenario 1c: Launch — aucune fenêtre suffisante → 7j observe ──
  describe('Scenario 1c: Launch observe mode', () => {
    it('should fallback to 7d observe mode when no window has enough clicks', () => {
      const m = makeMetricsByWindow(
        { clicks: 5, impressions: 80 },
        { clicks: 8, impressions: 150 },
        { clicks: 12, impressions: 250 },
      );

      const result = resolveDecisionWindow('launch', m);

      expect(result.chosenWindow).toBe(7);
      expect(result.isObserveMode).toBe(true);
      expect(result.reason).toBe('insufficient_clicks_observe_mode');
    });
  });

  // ── Scenario 4: Evergreen — toujours 30j ──
  describe('Scenario 4: Evergreen always 30d', () => {
    it('should always choose 30d for evergreen regardless of click counts', () => {
      const m = makeMetricsByWindow(
        { clicks: 100, orders: 5, spend: 50, sales: 150, impressions: 1000 },
        { clicks: 200, orders: 10, impressions: 2000 },
        { clicks: 450, orders: 25, spend: 220, sales: 700, impressions: 4500 },
      );

      const result = resolveDecisionWindow('evergreen', m);

      expect(result.chosenWindow).toBe(30);
      expect(result.isObserveMode).toBe(false);
      expect(result.reason).toBe('evergreen_always_30d');
      expect(result.metricsOnWindow.clicks).toBe(450);
    });

    it('should mark observe mode when evergreen has low clicks', () => {
      const m = makeMetricsByWindow(
        { clicks: 3 },
        { clicks: 8 },
        { clicks: 15 }, // < hard threshold for evergreen (20)
      );

      const result = resolveDecisionWindow('evergreen', m);

      expect(result.chosenWindow).toBe(30);
      expect(result.isObserveMode).toBe(true); // 15 < 20 (evergreen hard)
    });
  });

  // ── Scenario 5: Relaunch — 7j suffisant ──
  describe('Scenario 5: Relaunch 7d sufficient', () => {
    it('should choose 7d when clicks are sufficient', () => {
      const m = makeMetricsByWindow(
        { clicks: 18, orders: 1, spend: 12, sales: 25, impressions: 300 },
        { clicks: 30, orders: 2, impressions: 500 },
        { clicks: 60, orders: 5, impressions: 1000 },
      );

      const result = resolveDecisionWindow('relaunch', m);

      expect(result.chosenWindow).toBe(7);
      expect(result.isObserveMode).toBe(false);
      expect(result.reason).toBe('clicks_7d_sufficient');
    });

    it('should fallback to 14d observe for relaunch (not 7d like launch)', () => {
      const m = makeMetricsByWindow(
        { clicks: 5 },
        { clicks: 10 },
        { clicks: 12 },
      );

      const result = resolveDecisionWindow('relaunch', m);

      expect(result.chosenWindow).toBe(14);
      expect(result.isObserveMode).toBe(true);
    });
  });

  // ── Scenario 7: Pas de mélange de métriques ──
  describe('Scenario 7: No metric mixing', () => {
    it('should return metrics exclusively from the chosen window', () => {
      const m = makeMetricsByWindow(
        { clicks: 5, orders: 0, spend: 3, sales: 0, impressions: 100, units: 0 },
        { clicks: 20, orders: 2, spend: 15, sales: 40, impressions: 300, units: 2 },
        { clicks: 50, orders: 5, spend: 35, sales: 100, impressions: 800, units: 5 },
      );

      // Scale: 14d has 20 >= 15 → should choose 14d
      const result = resolveDecisionWindow('scale', m);

      expect(result.chosenWindow).toBe(14);
      // Verify ALL metrics come from window_14d, not mixed
      expect(result.metricsOnWindow.clicks).toBe(20);
      expect(result.metricsOnWindow.orders).toBe(2);
      expect(result.metricsOnWindow.spend).toBe(15);
      expect(result.metricsOnWindow.sales).toBe(40);
      expect(result.metricsOnWindow.impressions).toBe(300);
      expect(result.metricsOnWindow.units).toBe(2);
    });

    it('should NOT use 7d metrics for scale even if 7d has more clicks', () => {
      const m = makeMetricsByWindow(
        { clicks: 100, orders: 10, spend: 50, sales: 200 },  // 7d has the most data per day
        { clicks: 8, orders: 0, spend: 5, sales: 0 },         // 14d insufficient
        { clicks: 16, orders: 1, spend: 10, sales: 20 },       // 30d just sufficient
      );

      // Scale starts at 14d, not 7d
      const result = resolveDecisionWindow('scale', m);

      expect(result.chosenWindow).toBe(30); // 14d < 15, 30d >= 15
      expect(result.metricsOnWindow.clicks).toBe(16);
      expect(result.metricsOnWindow.orders).toBe(1);
    });
  });

  // ── Scale: 14d insufficient, 30d sufficient ──
  describe('Scale escalation to 30d', () => {
    it('should escalate to 30d when 14d has insufficient clicks', () => {
      const m = makeMetricsByWindow(
        { clicks: 8 },
        { clicks: 12 },
        { clicks: 25, orders: 1, spend: 15, sales: 20, impressions: 500 },
      );

      const result = resolveDecisionWindow('scale', m);

      expect(result.chosenWindow).toBe(30);
      expect(result.reason).toBe('clicks_30d_sufficient');
    });
  });
});

// ═══════════════════════════════════════════════════════════
// validateAgainstLongWindow
// ═══════════════════════════════════════════════════════════

describe('validateAgainstLongWindow', () => {
  const BREAK_EVEN = 35; // 35%

  // ── Scenario 2: Scale validation downgrade ──
  describe('Scenario 2: Scale pause + 30d profitable → downgrade', () => {
    it('should downgrade pause to soft_adjust when 30d is profitable', () => {
      const decisionMetrics = makeWindowMetrics({
        clicks: 20, orders: 0, spend: 15, sales: 0, // Bad: no sales
      });
      const longMetrics = makeWindowMetrics({
        clicks: 60, orders: 5, spend: 30, sales: 100, // Good: ACoS = 30% < 35%
      });

      const result = validateAgainstLongWindow('scale', decisionMetrics, longMetrics, 'pause', BREAK_EVEN);

      expect(result.applied).toBe(true);
      expect(result.reason).toBe('strong_action_but_30d_profitable');
      expect(result.downgradeLevel).toBe('soft_adjust');
    });

    it('should also downgrade add_negative when 30d is profitable', () => {
      const decisionMetrics = makeWindowMetrics({ clicks: 20, orders: 0, spend: 15, sales: 0 });
      const longMetrics = makeWindowMetrics({ clicks: 60, orders: 5, spend: 25, sales: 100 });

      const result = validateAgainstLongWindow('scale', decisionMetrics, longMetrics, 'add_negative', BREAK_EVEN);

      expect(result.applied).toBe(true);
      expect(result.downgradeLevel).toBe('soft_adjust');
    });

    it('should also downgrade bid_down when 30d is profitable', () => {
      const decisionMetrics = makeWindowMetrics({ clicks: 18, orders: 1, spend: 20, sales: 25 }); // ACoS 80%
      const longMetrics = makeWindowMetrics({ clicks: 60, orders: 8, spend: 30, sales: 100 }); // ACoS 30%

      const result = validateAgainstLongWindow('scale', decisionMetrics, longMetrics, 'bid_down', BREAK_EVEN);

      expect(result.applied).toBe(true);
      expect(result.downgradeLevel).toBe('soft_adjust');
    });
  });

  // ── Scenario 3: Scale both windows bad → action confirmed ──
  describe('Scenario 3: Scale 14d bad + 30d bad → action confirmed', () => {
    it('should confirm action when both windows are unprofitable', () => {
      const decisionMetrics = makeWindowMetrics({
        clicks: 20, orders: 0, spend: 25, sales: 0, // Terrible: no sales
      });
      const longMetrics = makeWindowMetrics({
        clicks: 50, orders: 2, spend: 60, sales: 40, // Bad: ACoS = 150% >> 35%
      });

      const result = validateAgainstLongWindow('scale', decisionMetrics, longMetrics, 'pause', BREAK_EVEN);

      expect(result.applied).toBe(false);
      expect(result.reason).toBe('both_windows_bad_action_confirmed');
    });
  });

  // ── Scenario: Decision good but 30d bad → observe ──
  describe('Decision good but 30d bad → observe', () => {
    it('should suggest observe when short-term is good but long-term is bad', () => {
      const decisionMetrics = makeWindowMetrics({
        clicks: 20, orders: 3, spend: 10, sales: 50, // ACoS 20% - great
      });
      const longMetrics = makeWindowMetrics({
        clicks: 60, orders: 4, spend: 50, sales: 80, // ACoS 62.5% - bad
      });

      const result = validateAgainstLongWindow('evergreen', decisionMetrics, longMetrics, 'bid_up', BREAK_EVEN);

      expect(result.applied).toBe(true);
      expect(result.reason).toBe('decision_good_but_30d_bad_observe');
      expect(result.downgradeLevel).toBe('observe');
    });
  });

  // ── Scenario: No validation for non-strong actions ──
  describe('Non-strong actions in scale/evergreen', () => {
    it('should not validate bid_up (not a strong action)', () => {
      const decisionMetrics = makeWindowMetrics({ clicks: 20, orders: 2, spend: 10, sales: 30 });
      const longMetrics = makeWindowMetrics({ clicks: 60, orders: 5, spend: 25, sales: 100 });

      const result = validateAgainstLongWindow('scale', decisionMetrics, longMetrics, 'bid_up', BREAK_EVEN);

      expect(result.applied).toBe(false);
      expect(result.reason).toBe('no_validation_needed');
    });
  });

  // ── Scenario 7 (validation): Launch — jamais de validation ──
  describe('Scenario: Launch never validated', () => {
    it('should never apply validation in launch phase', () => {
      const decisionMetrics = makeWindowMetrics({ clicks: 20, orders: 0, spend: 15, sales: 0 });
      const longMetrics = makeWindowMetrics({ clicks: 60, orders: 5, spend: 25, sales: 100 });

      const result = validateAgainstLongWindow('launch', decisionMetrics, longMetrics, 'pause', BREAK_EVEN);

      expect(result.applied).toBe(false);
      expect(result.reason).toBe('no_validation_for_launch');
    });
  });

  // ── Relaunch: lenient validation (only pause) ──
  describe('Relaunch lenient validation', () => {
    it('should downgrade pause when 30d is profitable', () => {
      const decisionMetrics = makeWindowMetrics({ clicks: 20, orders: 0, spend: 15, sales: 0 });
      const longMetrics = makeWindowMetrics({ clicks: 60, orders: 5, spend: 25, sales: 100 }); // profitable

      const result = validateAgainstLongWindow('relaunch', decisionMetrics, longMetrics, 'pause', BREAK_EVEN);

      expect(result.applied).toBe(true);
      expect(result.reason).toBe('pause_but_30d_profitable_relaunch');
      expect(result.downgradeLevel).toBe('soft_adjust');
    });

    it('should not validate bid_down in relaunch', () => {
      const decisionMetrics = makeWindowMetrics({ clicks: 20, orders: 1, spend: 20, sales: 25 });
      const longMetrics = makeWindowMetrics({ clicks: 60, orders: 5, spend: 25, sales: 100 });

      const result = validateAgainstLongWindow('relaunch', decisionMetrics, longMetrics, 'bid_down', BREAK_EVEN);

      expect(result.applied).toBe(false);
      expect(result.reason).toBe('relaunch_lenient_no_validation');
    });
  });
});

// ═══════════════════════════════════════════════════════════
// classifyActionIntensity
// ═══════════════════════════════════════════════════════════

describe('classifyActionIntensity', () => {
  it('should classify pause as strong', () => {
    expect(classifyActionIntensity('pause')).toBe('strong');
  });

  it('should classify add_negative as strong', () => {
    expect(classifyActionIntensity('add_negative')).toBe('strong');
  });

  it('should classify bid_down as soft', () => {
    expect(classifyActionIntensity('bid_down')).toBe('soft');
  });

  it('should classify bid_up as soft', () => {
    expect(classifyActionIntensity('bid_up')).toBe('soft');
  });

  it('should classify monitor as observe', () => {
    expect(classifyActionIntensity('monitor')).toBe('observe');
  });

  it('should classify patience as observe', () => {
    expect(classifyActionIntensity('patience')).toBe('observe');
  });

  it('should classify harvest as observe', () => {
    expect(classifyActionIntensity('harvest')).toBe('observe');
  });
});

// ═══════════════════════════════════════════════════════════
// applyLifecycleGuardrail
// ═══════════════════════════════════════════════════════════

describe('applyLifecycleGuardrail', () => {
  const BREAK_EVEN = 35;

  // ── Launch guardrail ──
  describe('Launch phase', () => {
    it('should downgrade pause on 7d window', () => {
      const result = applyLifecycleGuardrail('pause', 'launch', 7);
      expect(result.applied).toBe(true);
      expect(result.downgradeLevel).toBe('soft_adjust');
      expect(result.explanation).toContain('lancement');
    });

    it('should downgrade add_negative on 14d window', () => {
      const result = applyLifecycleGuardrail('add_negative', 'launch', 14);
      expect(result.applied).toBe(true);
      expect(result.downgradeLevel).toBe('soft_adjust');
    });

    it('should allow strong (pause) on 30d window', () => {
      const result = applyLifecycleGuardrail('pause', 'launch', 30);
      expect(result.applied).toBe(false);
      expect(result.reason).toBe('launch_30d_strong_allowed');
    });

    it('should not affect bid_down (soft intensity)', () => {
      const result = applyLifecycleGuardrail('bid_down', 'launch', 7);
      expect(result.applied).toBe(false);
      expect(result.reason).toBe('action_not_strong');
    });

    it('should not affect monitor (observe intensity)', () => {
      const result = applyLifecycleGuardrail('monitor', 'launch', 7);
      expect(result.applied).toBe(false);
    });
  });

  // ── Relaunch guardrail ──
  describe('Relaunch phase', () => {
    it('should downgrade pause on 7d window', () => {
      const result = applyLifecycleGuardrail('pause', 'relaunch', 7);
      expect(result.applied).toBe(true);
      expect(result.downgradeLevel).toBe('soft_adjust');
      expect(result.explanation).toContain('relance');
    });

    it('should downgrade pause on 14d without sufficient evidence', () => {
      const m = makeMetricsByWindow(
        { clicks: 5 },
        { clicks: 18, orders: 1, spend: 15, sales: 25 }, // ACoS ~60%, not 1.5x breakeven
        { clicks: 40, orders: 3, spend: 20, sales: 60 },  // ACoS 33% < breakeven
      );
      const result = applyLifecycleGuardrail('pause', 'relaunch', 14, m, BREAK_EVEN);
      expect(result.applied).toBe(true);
      expect(result.reason).toBe('relaunch_guardrail_14d_insufficient_evidence');
    });

    it('should allow strong on 14d with double clicks + very bad ACoS + 30d confirms', () => {
      const m = makeMetricsByWindow(
        { clicks: 15 },
        { clicks: 35, orders: 1, spend: 60, sales: 20 }, // ACoS 300% >> 52.5% (1.5 * 35)
        { clicks: 70, orders: 3, spend: 80, sales: 50 },  // ACoS 160% > 35%
      );
      const result = applyLifecycleGuardrail('pause', 'relaunch', 14, m, BREAK_EVEN);
      expect(result.applied).toBe(false);
      expect(result.reason).toBe('relaunch_14d_strong_confirmed');
    });

    it('should allow strong on 30d window', () => {
      const result = applyLifecycleGuardrail('pause', 'relaunch', 30);
      expect(result.applied).toBe(false);
      expect(result.reason).toBe('relaunch_30d_strong_allowed');
    });
  });

  // ── Scale guardrail (no restriction) ──
  describe('Scale phase', () => {
    it('should not restrict strong actions in scale', () => {
      const result = applyLifecycleGuardrail('pause', 'scale', 14);
      expect(result.applied).toBe(false);
      expect(result.reason).toBe('scale_evergreen_strong_allowed');
    });
  });

  // ── Evergreen guardrail (no restriction) ──
  describe('Evergreen phase', () => {
    it('should not restrict strong actions in evergreen', () => {
      const result = applyLifecycleGuardrail('pause', 'evergreen', 30);
      expect(result.applied).toBe(false);
      expect(result.reason).toBe('scale_evergreen_strong_allowed');
    });
  });
});
