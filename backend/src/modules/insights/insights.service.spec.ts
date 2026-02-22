import { InsightsService } from './insights.service';
import {
  CampaignDiagnosisCode,
  EntityDiagnosisCode,
  MacroStrategyCode,
  type InsightMetrics,
  type InsightCampaignInput,
  type InsightEntityInput,
  type EntityInsight,
  type CampaignMacroStrategy,
} from './types';

/**
 * Tests unitaires du InsightsService — Diagnostics déterministes
 *
 * Couvre :
 * - 7 Campaign Diagnosis Codes
 * - 8 Entity Diagnosis Codes (NO_IMPRESSIONS, ZERO_CLICKS, VERY_LOW_CLICKS, LOW_CLICKS, CLICKS_NO_SALES, EXPENSIVE_BUT_VALID, WINNER, BOOST_CANDIDATE)
 * - Eligibility (séparation diagnostic vs action)
 * - 3 Break-Even Guards
 * - 3 Lifecycle Variations
 * - 5 Edge Cases
 * - 4 Confidence Scoring
 * - 5 Macro Strategy Scenarios
 */
describe('InsightsService', () => {
  let service: InsightsService;

  beforeEach(() => {
    service = new InsightsService();
  });

  // ── Helpers ──────────────────────────────────────────────

  function makeCampaign(overrides?: Partial<InsightCampaignInput>): InsightCampaignInput {
    return { id: 'camp-1', name: 'Test Campaign', dailyBudget: null, ...overrides };
  }

  function makeEntity(overrides?: Partial<InsightEntityInput>): InsightEntityInput {
    return {
      key: 'keyword:123',
      type: 'keyword',
      name: 'test keyword',
      campaignId: 'camp-1',
      campaignName: 'Test Campaign',
      ...overrides,
    };
  }

  function makeMetrics(overrides?: Partial<InsightMetrics>): InsightMetrics {
    return {
      impressions: 0,
      clicks: 0,
      spend: 0,
      sales: 0,
      orders: 0,
      units: 0,
      ...overrides,
    };
  }

  function makeEntityInsight(diagnosisCode: EntityDiagnosisCode, eligibility: boolean): EntityInsight {
    return {
      entityKey: `keyword:${Math.random().toString(36).slice(2)}`,
      entityType: 'keyword',
      diagnosisCode,
      eligibility,
      summaryFacts: { impressions: 0, clicks: 0, ctr: null, orders: 0, cvr: null, spend: 0, sales: 0, acos: null, periodDays: 14 },
      suggestedActions: [],
      confidenceScore: 10,
    };
  }

  const BREAK_EVEN = 35; // 35% royalty rate
  const PERIOD_DAYS = 14;

  // ══════════════════════════════════════════════════════════
  // CAMPAIGN DIAGNOSIS CODES (7 tests)
  // ══════════════════════════════════════════════════════════

  describe('Campaign Diagnosis Codes', () => {
    it('should detect INVISIBLE when impressions === 0', () => {
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 0, clicks: 0 }),
        BREAK_EVEN,
        PERIOD_DAYS,
        [],
      );
      expect(insight.diagnosisCode).toBe(CampaignDiagnosisCode.INVISIBLE);
    });

    it('should detect IGNORED when impressions > 0 but clicks === 0', () => {
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 500, clicks: 0 }),
        BREAK_EVEN,
        PERIOD_DAYS,
        [],
      );
      expect(insight.diagnosisCode).toBe(CampaignDiagnosisCode.IGNORED);
    });

    it('should detect TOO_EARLY when clicks < 15', () => {
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 200, clicks: 10, spend: 5, sales: 0, orders: 0 }),
        BREAK_EVEN,
        PERIOD_DAYS,
        [],
      );
      expect(insight.diagnosisCode).toBe(CampaignDiagnosisCode.TOO_EARLY);
    });

    it('should detect ATTRACTIVE_NOT_CONVERTING when clicks >= 15 and orders === 0', () => {
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 1000, clicks: 50, spend: 25, sales: 0, orders: 0 }),
        BREAK_EVEN,
        PERIOD_DAYS,
        [],
      );
      expect(insight.diagnosisCode).toBe(CampaignDiagnosisCode.ATTRACTIVE_NOT_CONVERTING);
    });

    it('should detect PROFITABLE when orders > 0 and ACoS <= breakEven * 1.5', () => {
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 1000, clicks: 80, spend: 50, sales: 200, orders: 5 }),
        BREAK_EVEN, // ACoS = 50/200*100 = 25% ≤ 35*1.5=52.5%
        PERIOD_DAYS,
        [],
      );
      expect(insight.diagnosisCode).toBe(CampaignDiagnosisCode.PROFITABLE);
    });

    it('should detect PROMISING_BUT_EXPENSIVE when ACoS > breakEven * 1.5', () => {
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 500, clicks: 30, spend: 100, sales: 80, orders: 2 }),
        BREAK_EVEN, // ACoS = 100/80*100 = 125% > 35*1.5=52.5%
        PERIOD_DAYS,
        [],
      );
      expect(insight.diagnosisCode).toBe(CampaignDiagnosisCode.PROMISING_BUT_EXPENSIVE);
    });

    it('should detect LIMITED_BY_BUDGET when spend >= dailyBudget * days * 0.95', () => {
      const insight = service.computeCampaignInsight(
        makeCampaign({ dailyBudget: 10 }),
        makeMetrics({ impressions: 1000, clicks: 80, spend: 135, sales: 400, orders: 10 }),
        BREAK_EVEN,
        PERIOD_DAYS, // dailyBudget * days * 0.95 = 10 * 14 * 0.95 = 133
        [],
        10,
      );
      expect(insight.diagnosisCode).toBe(CampaignDiagnosisCode.LIMITED_BY_BUDGET);
    });
  });

  // ══════════════════════════════════════════════════════════
  // ENTITY DIAGNOSIS CODES — 5 cas pré-eligibility + 3 post
  // ══════════════════════════════════════════════════════════

  describe('Entity Diagnosis Codes', () => {
    // ── Pré-eligibility (eligibility = false) ──

    it('NO_IMPRESSIONS: impressions === 0 → "Pas diffusé"', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.NO_IMPRESSIONS);
      expect(insight.eligibility).toBe(false);
    });

    it('ZERO_CLICKS: impressions > 0, clicks === 0 → "Vu mais ignoré"', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 0, spend: 0, sales: 0, orders: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.ZERO_CLICKS);
      expect(insight.eligibility).toBe(false);
    });

    it('VERY_LOW_CLICKS: 1-4 clicks → "Très peu de clics"', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 3, spend: 1, sales: 0, orders: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.VERY_LOW_CLICKS);
      expect(insight.eligibility).toBe(false);
    });

    it('VERY_LOW_CLICKS: boundary — 1 click', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 200, clicks: 1, spend: 0.5, sales: 0, orders: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.VERY_LOW_CLICKS);
      expect(insight.eligibility).toBe(false);
    });

    it('VERY_LOW_CLICKS: boundary — 4 clicks', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 200, clicks: 4, spend: 2, sales: 0, orders: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.VERY_LOW_CLICKS);
      expect(insight.eligibility).toBe(false);
    });

    it('LOW_CLICKS: 5-14 clicks → "Début de signal"', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 300, clicks: 10, spend: 5, sales: 0, orders: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.LOW_CLICKS);
      expect(insight.eligibility).toBe(false);
    });

    it('LOW_CLICKS: boundary — exactly 5 clicks', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 200, clicks: 5, spend: 2.5, sales: 0, orders: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.LOW_CLICKS);
      expect(insight.eligibility).toBe(false);
    });

    it('LOW_CLICKS: boundary — 14 clicks', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 300, clicks: 14, spend: 7, sales: 0, orders: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.LOW_CLICKS);
      expect(insight.eligibility).toBe(false);
    });

    // ── Post-eligibility (eligibility = true) ──

    it('CLICKS_NO_SALES: clicks >= 15, orders === 0 → eligibility = true', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 25, spend: 15, sales: 0, orders: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.CLICKS_NO_SALES);
      expect(insight.eligibility).toBe(true);
    });

    it('CLICKS_NO_SALES: boundary — exactly 15 clicks', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 15, spend: 7.5, sales: 0, orders: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.CLICKS_NO_SALES);
      expect(insight.eligibility).toBe(true);
    });

    it('WINNER: orders > 0, ACoS <= breakEven → eligibility = true', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 50, spend: 30, sales: 150, orders: 5 }),
        'scale',
        BREAK_EVEN, // ACoS = 30/150*100 = 20% ≤ 35%
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.WINNER);
      expect(insight.eligibility).toBe(true);
    });

    it('BOOST_CANDIDATE: WINNER + CTR > avgCampaignCTR → eligibility = true', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 200, clicks: 20, spend: 15, sales: 100, orders: 4 }),
        'scale',
        BREAK_EVEN, // ACoS = 15/100*100 = 15% ≤ 35%
        PERIOD_DAYS,
        5.0, // avgCampaignCTR = 5%, entity CTR = 20/200*100 = 10% > 5%
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.BOOST_CANDIDATE);
      expect(insight.eligibility).toBe(true);
    });

    it('EXPENSIVE_BUT_VALID: orders > 0, breakEven < ACoS <= breakEven * 1.3 → eligibility = true', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 30, spend: 50, sales: 120, orders: 3 }),
        'scale',
        BREAK_EVEN, // ACoS = 50/120*100 = 41.7%, breakEven*1.3 = 45.5% → 35 < 41.7 ≤ 45.5
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.EXPENSIVE_BUT_VALID);
      expect(insight.eligibility).toBe(true);
    });

    it('CLICKS_NO_SALES via high ACoS: orders > 0 but ACoS > breakEven * 1.3', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 30, spend: 100, sales: 80, orders: 2 }),
        'scale',
        BREAK_EVEN, // ACoS = 125% > 35*1.3=45.5%
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.CLICKS_NO_SALES);
      expect(insight.eligibility).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════
  // ELIGIBILITY SEPARATION (explicit tests)
  // ══════════════════════════════════════════════════════════

  describe('Eligibility', () => {
    it('should be false for all pre-15-clicks diagnoses', () => {
      const cases = [
        makeMetrics({ impressions: 0, clicks: 0 }),              // NO_IMPRESSIONS
        makeMetrics({ impressions: 100, clicks: 0 }),             // ZERO_CLICKS
        makeMetrics({ impressions: 100, clicks: 3 }),             // VERY_LOW_CLICKS
        makeMetrics({ impressions: 300, clicks: 10 }),            // LOW_CLICKS
      ];
      for (const m of cases) {
        const insight = service.computeEntityInsight(
          makeEntity(), m, 'scale', BREAK_EVEN, PERIOD_DAYS,
        );
        expect(insight.eligibility).toBe(false);
      }
    });

    it('should be true for all 15+ clicks diagnoses', () => {
      const cases = [
        makeMetrics({ impressions: 500, clicks: 15, spend: 10, sales: 0, orders: 0 }),    // CLICKS_NO_SALES
        makeMetrics({ impressions: 500, clicks: 50, spend: 30, sales: 150, orders: 5 }),   // WINNER
        makeMetrics({ impressions: 500, clicks: 30, spend: 50, sales: 120, orders: 3 }),   // EXPENSIVE_BUT_VALID
      ];
      for (const m of cases) {
        const insight = service.computeEntityInsight(
          makeEntity(), m, 'scale', BREAK_EVEN, PERIOD_DAYS,
        );
        expect(insight.eligibility).toBe(true);
      }
    });

    it('every diagnosis should have a non-empty suggestedActions list (even pre-eligibility) for entity insights', () => {
      const cases = [
        makeMetrics({ impressions: 0 }),                         // NO_IMPRESSIONS
        makeMetrics({ impressions: 100, clicks: 0 }),             // ZERO_CLICKS
        makeMetrics({ impressions: 200, clicks: 3 }),             // VERY_LOW_CLICKS
        makeMetrics({ impressions: 300, clicks: 10 }),            // LOW_CLICKS
        makeMetrics({ impressions: 500, clicks: 25, spend: 15, sales: 0, orders: 0 }), // CLICKS_NO_SALES
        makeMetrics({ impressions: 500, clicks: 50, spend: 30, sales: 150, orders: 5 }), // WINNER
      ];
      for (const m of cases) {
        const insight = service.computeEntityInsight(
          makeEntity(), m, 'scale', BREAK_EVEN, PERIOD_DAYS,
        );
        expect(insight.suggestedActions.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ══════════════════════════════════════════════════════════
  // BREAK-EVEN GUARD (3 tests)
  // ══════════════════════════════════════════════════════════

  describe('Break-Even Guard', () => {
    it('should NEVER suggest pause for a profitable keyword (orders > 0, ACoS < breakEven)', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 100, spend: 30, sales: 150, orders: 5 }),
        'scale',
        BREAK_EVEN, // ACoS = 20% < 35%
        PERIOD_DAYS,
      );
      const hasPause = insight.suggestedActions.some(a => a.type === 'pause');
      expect(hasPause).toBe(false);
    });

    it('should suggest pause-compatible actions for unprofitable keyword (orders=0, clicks >= 15)', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 25, spend: 20, sales: 0, orders: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      // CLICKS_NO_SALES → actions include improve_listing, add_negative
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.CLICKS_NO_SALES);
      expect(insight.suggestedActions.length).toBeGreaterThan(0);
    });

    it('should suggest bid_down (not pause) for marginal keyword above break-even', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 30, spend: 50, sales: 120, orders: 3 }),
        'scale',
        BREAK_EVEN, // ACoS = 41.7% — slightly above 35% but within 1.3x
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.EXPENSIVE_BUT_VALID);
      const firstAction = insight.suggestedActions[0];
      expect(firstAction.type).toBe('bid_down');
      const hasPause = insight.suggestedActions.some(a => a.type === 'pause');
      expect(hasPause).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════
  // LIFECYCLE VARIATIONS (3 tests)
  // ══════════════════════════════════════════════════════════

  describe('Lifecycle Variations', () => {
    it('should add patience in launch phase', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 200, clicks: 10, spend: 5, sales: 0, orders: 0 }),
        'launch',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      const hasPatience = insight.suggestedActions.some(a => a.type === 'patience');
      expect(hasPatience).toBe(true);
    });

    it('should prioritize bid_up/harvest in scale phase for winners', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 50, spend: 30, sales: 150, orders: 5 }),
        'scale',
        BREAK_EVEN, // ACoS = 20%
        PERIOD_DAYS,
      );
      expect(insight.suggestedActions[0].type).toBe('bid_up');
    });

    it('should add monitor in evergreen phase', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 50, spend: 30, sales: 150, orders: 5 }),
        'evergreen',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      const hasMonitor = insight.suggestedActions.some(a => a.type === 'monitor');
      expect(hasMonitor).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════
  // EDGE CASES (5 tests)
  // ══════════════════════════════════════════════════════════

  describe('Edge Cases', () => {
    it('should handle zero sales (ACoS null)', () => {
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 500, clicks: 30, spend: 20, sales: 0, orders: 0 }),
        BREAK_EVEN,
        PERIOD_DAYS,
        [],
      );
      expect(insight.summaryFacts.acos).toBeNull();
      expect(insight.diagnosisCode).toBe(CampaignDiagnosisCode.ATTRACTIVE_NOT_CONVERTING);
    });

    it('should handle zero clicks gracefully', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 100, clicks: 0, spend: 0, sales: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.ZERO_CLICKS);
      expect(insight.summaryFacts.ctr).toBe(0);
      expect(insight.summaryFacts.cvr).toBeNull();
    });

    it('should handle very low CTR (< 0.1%) — still VERY_LOW_CLICKS if clicks < 5', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 10000, clicks: 4, spend: 2, sales: 0, orders: 0 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      // CTR = 0.04% — but now diagnosis is based on click count, not CTR
      expect(insight.diagnosisCode).toBe(EntityDiagnosisCode.VERY_LOW_CLICKS);
    });

    it('should handle extremely high ACoS (> 200%)', () => {
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 500, clicks: 30, spend: 100, sales: 30, orders: 1 }),
        BREAK_EVEN, // ACoS = 100/30*100 = 333% > 52.5%
        PERIOD_DAYS,
        [],
      );
      expect(insight.diagnosisCode).toBe(CampaignDiagnosisCode.PROMISING_BUT_EXPENSIVE);
    });

    it('should handle budget exactly at cap', () => {
      const insight = service.computeCampaignInsight(
        makeCampaign({ dailyBudget: 10 }),
        makeMetrics({ impressions: 1000, clicks: 80, spend: 133, sales: 400, orders: 10 }),
        BREAK_EVEN,
        PERIOD_DAYS, // threshold = 10 * 14 * 0.95 = 133
        [],
        10,
      );
      expect(insight.diagnosisCode).toBe(CampaignDiagnosisCode.LIMITED_BY_BUDGET);
    });
  });

  // ══════════════════════════════════════════════════════════
  // CONFIDENCE SCORE (4 tests)
  // ══════════════════════════════════════════════════════════

  describe('Confidence Score', () => {
    it('should return 10 for 0 clicks', () => {
      expect(service.computeConfidence(0)).toBe(10);
    });

    it('should return ~50 for 15 clicks', () => {
      const score = service.computeConfidence(15);
      expect(score).toBeGreaterThanOrEqual(48);
      expect(score).toBeLessThanOrEqual(52);
    });

    it('should return 70-85 for 150 clicks', () => {
      const score = service.computeConfidence(150);
      expect(score).toBeGreaterThanOrEqual(70);
      expect(score).toBeLessThanOrEqual(85);
    });

    it('should cap at 100', () => {
      const score = service.computeConfidence(10000);
      expect(score).toBe(100);
    });
  });

  // ══════════════════════════════════════════════════════════
  // INSIGHT STRUCTURE INTEGRITY (4 tests)
  // ══════════════════════════════════════════════════════════

  describe('Insight Structure', () => {
    it('should always produce 1-3 suggested actions for all entity codes', () => {
      const testCases = [
        makeMetrics({ impressions: 0 }),                                                   // NO_IMPRESSIONS
        makeMetrics({ impressions: 100, clicks: 0 }),                                       // ZERO_CLICKS
        makeMetrics({ impressions: 200, clicks: 3 }),                                       // VERY_LOW_CLICKS
        makeMetrics({ impressions: 300, clicks: 10 }),                                      // LOW_CLICKS
        makeMetrics({ impressions: 500, clicks: 25, spend: 15, sales: 0, orders: 0 }),      // CLICKS_NO_SALES
        makeMetrics({ impressions: 500, clicks: 50, spend: 30, sales: 150, orders: 5 }),    // WINNER
        makeMetrics({ impressions: 500, clicks: 30, spend: 50, sales: 120, orders: 3 }),    // EXPENSIVE_BUT_VALID
      ];
      for (const m of testCases) {
        const insight = service.computeEntityInsight(
          makeEntity(), m, 'scale', BREAK_EVEN, PERIOD_DAYS,
        );
        expect(insight.suggestedActions.length).toBeGreaterThanOrEqual(1);
        expect(insight.suggestedActions.length).toBeLessThanOrEqual(3);
      }
    });

    it('should populate summaryFacts correctly', () => {
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 1000, clicks: 100, spend: 50, sales: 200, orders: 5, units: 5 }),
        BREAK_EVEN,
        PERIOD_DAYS,
        [],
      );
      expect(insight.summaryFacts.impressions).toBe(1000);
      expect(insight.summaryFacts.clicks).toBe(100);
      expect(insight.summaryFacts.ctr).toBe(10); // 100/1000*100
      expect(insight.summaryFacts.orders).toBe(5);
      expect(insight.summaryFacts.cvr).toBe(5); // 5/100*100
      expect(insight.summaryFacts.spend).toBe(50);
      expect(insight.summaryFacts.sales).toBe(200);
      expect(insight.summaryFacts.acos).toBe(25); // 50/200*100
      expect(insight.summaryFacts.periodDays).toBe(PERIOD_DAYS);
    });

    it('should include linkedRecommendation when provided (entity insights only)', () => {
      const linkedReco = {
        id: 'reco-1',
        actionType: 'bid_up_high_performer',
        strategyScore: 95,
        strategyLabel: 'Recommandé en Scaling',
      };
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 500, clicks: 50, spend: 30, sales: 150, orders: 5 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
        undefined,
        linkedReco,
      );
      expect(insight.linkedRecommendation).toBeDefined();
      expect(insight.linkedRecommendation!.id).toBe('reco-1');
      expect(insight.linkedRecommendation!.strategyScore).toBe(95);
    });

    it('should include eligibility field in all entity insights', () => {
      const insight = service.computeEntityInsight(
        makeEntity(),
        makeMetrics({ impressions: 100, clicks: 3 }),
        'scale',
        BREAK_EVEN,
        PERIOD_DAYS,
      );
      expect(typeof insight.eligibility).toBe('boolean');
    });
  });

  // ══════════════════════════════════════════════════════════
  // MACRO STRATEGY (5 scenarios)
  // ══════════════════════════════════════════════════════════

  describe('Macro Strategy', () => {
    it('Scenario 1: SCALE_WINNERS — 2 winners + 3 testing', () => {
      const entityInsights: EntityInsight[] = [
        // 2 winners
        makeEntityInsight(EntityDiagnosisCode.WINNER, true),
        makeEntityInsight(EntityDiagnosisCode.WINNER, true),
        // 3 testing
        makeEntityInsight(EntityDiagnosisCode.LOW_CLICKS, false),
        makeEntityInsight(EntityDiagnosisCode.VERY_LOW_CLICKS, false),
        makeEntityInsight(EntityDiagnosisCode.LOW_CLICKS, false),
      ];
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 1000, clicks: 80, spend: 50, sales: 200, orders: 5 }),
        BREAK_EVEN,
        PERIOD_DAYS,
        entityInsights,
      );
      expect(insight.macroStrategy.macroStrategyCode).toBe(MacroStrategyCode.SCALE_WINNERS);
      expect(insight.macroStrategy.winnersCount).toBe(2);
      expect(insight.macroStrategy.testingCount).toBe(3);
    });

    it('Scenario 2: CONTINUE_TESTING — 0 winners + 5 testing', () => {
      const entityInsights: EntityInsight[] = [
        makeEntityInsight(EntityDiagnosisCode.LOW_CLICKS, false),
        makeEntityInsight(EntityDiagnosisCode.VERY_LOW_CLICKS, false),
        makeEntityInsight(EntityDiagnosisCode.LOW_CLICKS, false),
        makeEntityInsight(EntityDiagnosisCode.ZERO_CLICKS, false),
        makeEntityInsight(EntityDiagnosisCode.NO_IMPRESSIONS, false),
      ];
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 500, clicks: 30, spend: 20, sales: 0, orders: 0 }),
        BREAK_EVEN,
        PERIOD_DAYS,
        entityInsights,
      );
      expect(insight.macroStrategy.macroStrategyCode).toBe(MacroStrategyCode.CONTINUE_TESTING);
    });

    it('Scenario 3: CUT_LOSERS — 0 winners + 3 losers out of 4 eligible', () => {
      const entityInsights: EntityInsight[] = [
        makeEntityInsight(EntityDiagnosisCode.CLICKS_NO_SALES, true),
        makeEntityInsight(EntityDiagnosisCode.CLICKS_NO_SALES, true),
        makeEntityInsight(EntityDiagnosisCode.CLICKS_NO_SALES, true),
        makeEntityInsight(EntityDiagnosisCode.EXPENSIVE_BUT_VALID, true),
      ];
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 500, clicks: 30, spend: 20, sales: 0, orders: 0 }),
        BREAK_EVEN,
        PERIOD_DAYS,
        entityInsights,
      );
      expect(insight.macroStrategy.macroStrategyCode).toBe(MacroStrategyCode.CUT_LOSERS);
      expect(insight.macroStrategy.losersCount).toBe(3);
    });

    it('Scenario 4: FIX_LISTING — 1 loser, 0 winners, not majority', () => {
      const entityInsights: EntityInsight[] = [
        makeEntityInsight(EntityDiagnosisCode.CLICKS_NO_SALES, true),
        makeEntityInsight(EntityDiagnosisCode.LOW_CLICKS, false),
        makeEntityInsight(EntityDiagnosisCode.VERY_LOW_CLICKS, false),
      ];
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 300, clicks: 20, spend: 15, sales: 0, orders: 0 }),
        BREAK_EVEN,
        PERIOD_DAYS,
        entityInsights,
      );
      expect(insight.macroStrategy.macroStrategyCode).toBe(MacroStrategyCode.FIX_LISTING);
    });

    it('Scenario 5: NO_SIGNAL_YET — empty array', () => {
      const entityInsights: EntityInsight[] = [];
      const insight = service.computeCampaignInsight(
        makeCampaign(),
        makeMetrics({ impressions: 200, clicks: 10, spend: 5, sales: 0, orders: 0 }),
        BREAK_EVEN,
        PERIOD_DAYS,
        entityInsights,
      );
      expect(insight.macroStrategy.macroStrategyCode).toBe(MacroStrategyCode.NO_SIGNAL_YET);
    });
  });
});
