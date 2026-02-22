import { t } from '@/lib/i18n';

// ── Enums (mirror backend) ──────────────────────────────────

export enum CampaignDiagnosisCode {
  INVISIBLE = 'invisible',
  LOW_SIGNAL = 'low_signal',
  IGNORED = 'ignored',
  TOO_EARLY = 'too_early',
  ATTRACTIVE_NOT_CONVERTING = 'attractive_not_converting',
  PROMISING_BUT_EXPENSIVE = 'promising_but_expensive',
  PROFITABLE = 'profitable',
  LIMITED_BY_BUDGET = 'limited_by_budget',
}

export enum TrendDirection {
  UP = 'up',
  STABLE = 'stable',
  DOWN = 'down',
}

export enum EntityDiagnosisCode {
  NO_IMPRESSIONS = 'no_impressions',
  ZERO_CLICKS = 'zero_clicks',
  VERY_LOW_CLICKS = 'very_low_clicks',
  LOW_CLICKS = 'low_clicks',
  CLICKS_NO_SALES = 'clicks_no_sales',
  EXPENSIVE_BUT_VALID = 'expensive_but_valid',
  WINNER = 'winner',
  BOOST_CANDIDATE = 'boost_candidate',
}

export type ActionExecution = 'ads' | 'book' | 'none';

export enum MacroStrategyCode {
  SCALE_WINNERS = 'scale_winners',
  CONTINUE_TESTING = 'continue_testing',
  FIX_LISTING = 'fix_listing',
  CUT_LOSERS = 'cut_losers',
  NO_SIGNAL_YET = 'no_signal_yet',
}

// ── Interfaces (mirror backend) ─────────────────────────────

export interface InsightAction {
  type: string;
  execution: ActionExecution;
  i18nKey: string;
  priority: number;
}

export interface SummaryFacts {
  impressions: number;
  clicks: number;
  ctr: number | null;
  orders: number;
  cvr: number | null;
  spend: number;
  sales: number;
  acos: number | null;
  periodDays: number;
}

export interface CampaignMacroStrategy {
  macroStrategyCode: MacroStrategyCode;
  winnersCount: number;
  boostCandidatesCount: number;
  testingCount: number;
  ignoredCount: number;
  losersCount: number;
  expensiveCount: number;
  totalEntities: number;
  eligibleCount: number;
}

export interface CampaignInsight {
  campaignId: string;
  diagnosisCode: CampaignDiagnosisCode;
  summaryFacts: SummaryFacts;
  macroStrategy: CampaignMacroStrategy;
  confidenceScore: number;
  strategicPeriodDays: number;
  trendDirection: TrendDirection;
  trendAnalysis?: {
    strategicAcos: number | null;
    trendAcos: number | null;
    strategicCvr: number | null;
    trendCvr: number | null;
  };
}

export interface EntityInsight {
  entityKey: string;
  entityType: 'keyword' | 'target' | 'search_term' | 'ad_group';
  diagnosisCode: EntityDiagnosisCode;
  eligibility: boolean;
  summaryFacts: SummaryFacts;
  suggestedActions: InsightAction[];
  linkedRecommendation?: {
    id: string;
    actionType: string;
    strategyScore: number;
    strategyLabel: string;
  };
  confidenceScore: number;
}

// ── Rendered Insight ────────────────────────────────────────

export interface RenderedInsight {
  title: string;
  badgeText: string;
  explanation: string;
  summaryText: string;
  nextStepText?: string;
  actions: Array<{
    label: string;
    execution: ActionExecution;
    executionLabel: string;
    type: string;
  }>;
  confidenceLabel: string;
  confidenceLevel: 'high' | 'medium' | 'low';
}

export interface RenderedCampaignStrategy {
  strategyTitle: string;
  strategySummary: string;
  explanation: string;
  summaryText: string;
  confidenceLabel: string;
  confidenceLevel: 'high' | 'medium' | 'low';
  trendLabel: string;
  trendDirection: TrendDirection;
  periodLabel: string;
}

// ── Templates ───────────────────────────────────────────────

interface InsightTemplate {
  titleKey: string;
  badgeKey?: string;
  explanationKey: string;
  summaryKey: string;
  nextStepKey?: string;
}

const CAMPAIGN_INSIGHT_TEMPLATES: Record<string, InsightTemplate> = {
  [CampaignDiagnosisCode.INVISIBLE]: {
    titleKey: 'insights.campaign.invisible.title',
    explanationKey: 'insights.campaign.invisible.explanation',
    summaryKey: 'insights.campaign.invisible.summary',
  },
  [CampaignDiagnosisCode.LOW_SIGNAL]: {
    titleKey: 'insights.campaign.low_signal.title',
    explanationKey: 'insights.campaign.low_signal.explanation',
    summaryKey: 'insights.campaign.low_signal.summary',
  },
  [CampaignDiagnosisCode.IGNORED]: {
    titleKey: 'insights.campaign.ignored.title',
    explanationKey: 'insights.campaign.ignored.explanation',
    summaryKey: 'insights.campaign.ignored.summary',
  },
  [CampaignDiagnosisCode.TOO_EARLY]: {
    titleKey: 'insights.campaign.too_early.title',
    explanationKey: 'insights.campaign.too_early.explanation',
    summaryKey: 'insights.campaign.too_early.summary',
  },
  [CampaignDiagnosisCode.ATTRACTIVE_NOT_CONVERTING]: {
    titleKey: 'insights.campaign.attractive_not_converting.title',
    explanationKey: 'insights.campaign.attractive_not_converting.explanation',
    summaryKey: 'insights.campaign.attractive_not_converting.summary',
  },
  [CampaignDiagnosisCode.PROMISING_BUT_EXPENSIVE]: {
    titleKey: 'insights.campaign.promising_but_expensive.title',
    explanationKey: 'insights.campaign.promising_but_expensive.explanation',
    summaryKey: 'insights.campaign.promising_but_expensive.summary',
  },
  [CampaignDiagnosisCode.PROFITABLE]: {
    titleKey: 'insights.campaign.profitable.title',
    explanationKey: 'insights.campaign.profitable.explanation',
    summaryKey: 'insights.campaign.profitable.summary',
  },
  [CampaignDiagnosisCode.LIMITED_BY_BUDGET]: {
    titleKey: 'insights.campaign.limited_by_budget.title',
    explanationKey: 'insights.campaign.limited_by_budget.explanation',
    summaryKey: 'insights.campaign.limited_by_budget.summary',
  },
};

const ENTITY_INSIGHT_TEMPLATES: Record<string, InsightTemplate> = {
  [EntityDiagnosisCode.NO_IMPRESSIONS]: {
    titleKey: 'insights.entity.no_impressions.title',

    explanationKey: 'insights.entity.no_impressions.explanation',
    summaryKey: 'insights.entity.no_impressions.summary',
    nextStepKey: 'insights.entity.no_impressions.nextStep',
  },
  [EntityDiagnosisCode.ZERO_CLICKS]: {
    titleKey: 'insights.entity.zero_clicks.title',

    explanationKey: 'insights.entity.zero_clicks.explanation',
    summaryKey: 'insights.entity.zero_clicks.summary',
    nextStepKey: 'insights.entity.zero_clicks.nextStep',
  },
  [EntityDiagnosisCode.VERY_LOW_CLICKS]: {
    titleKey: 'insights.entity.very_low_clicks.title',

    explanationKey: 'insights.entity.very_low_clicks.explanation',
    summaryKey: 'insights.entity.very_low_clicks.summary',
    nextStepKey: 'insights.entity.very_low_clicks.nextStep',
  },
  [EntityDiagnosisCode.LOW_CLICKS]: {
    titleKey: 'insights.entity.low_clicks.title',

    explanationKey: 'insights.entity.low_clicks.explanation',
    summaryKey: 'insights.entity.low_clicks.summary',
    nextStepKey: 'insights.entity.low_clicks.nextStep',
  },
  [EntityDiagnosisCode.CLICKS_NO_SALES]: {
    titleKey: 'insights.entity.clicks_no_sales.title',

    explanationKey: 'insights.entity.clicks_no_sales.explanation',
    summaryKey: 'insights.entity.clicks_no_sales.summary',
    nextStepKey: 'insights.entity.clicks_no_sales.nextStep',
  },
  [EntityDiagnosisCode.EXPENSIVE_BUT_VALID]: {
    titleKey: 'insights.entity.expensive_but_valid.title',

    explanationKey: 'insights.entity.expensive_but_valid.explanation',
    summaryKey: 'insights.entity.expensive_but_valid.summary',
    nextStepKey: 'insights.entity.expensive_but_valid.nextStep',
  },
  [EntityDiagnosisCode.WINNER]: {
    titleKey: 'insights.entity.winner.title',

    explanationKey: 'insights.entity.winner.explanation',
    summaryKey: 'insights.entity.winner.summary',
    nextStepKey: 'insights.entity.winner.nextStep',
  },
  [EntityDiagnosisCode.BOOST_CANDIDATE]: {
    titleKey: 'insights.entity.boost_candidate.title',

    explanationKey: 'insights.entity.boost_candidate.explanation',
    summaryKey: 'insights.entity.boost_candidate.summary',
    nextStepKey: 'insights.entity.boost_candidate.nextStep',
  },
};

// ── Diagnosis colors (for badges) ───────────────────────────

export const CAMPAIGN_DIAGNOSIS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  [CampaignDiagnosisCode.INVISIBLE]: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-300' },
  [CampaignDiagnosisCode.LOW_SIGNAL]: { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200' },
  [CampaignDiagnosisCode.IGNORED]: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300' },
  [CampaignDiagnosisCode.TOO_EARLY]: { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200' },
  [CampaignDiagnosisCode.ATTRACTIVE_NOT_CONVERTING]: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-300' },
  [CampaignDiagnosisCode.PROMISING_BUT_EXPENSIVE]: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300' },
  [CampaignDiagnosisCode.PROFITABLE]: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300' },
  [CampaignDiagnosisCode.LIMITED_BY_BUDGET]: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300' },
};

export const ENTITY_DIAGNOSIS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  [EntityDiagnosisCode.NO_IMPRESSIONS]: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-300' },
  [EntityDiagnosisCode.ZERO_CLICKS]: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300' },
  [EntityDiagnosisCode.VERY_LOW_CLICKS]: { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200' },
  [EntityDiagnosisCode.LOW_CLICKS]: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
  [EntityDiagnosisCode.CLICKS_NO_SALES]: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300' },
  [EntityDiagnosisCode.EXPENSIVE_BUT_VALID]: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300' },
  [EntityDiagnosisCode.WINNER]: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300' },
  [EntityDiagnosisCode.BOOST_CANDIDATE]: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300' },
};

// ── Macro strategy colors ───────────────────────────────────

export const MACRO_STRATEGY_COLORS: Record<string, { bg: string; text: string; border: string; icon: string }> = {
  [MacroStrategyCode.SCALE_WINNERS]: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300', icon: '🚀' },
  [MacroStrategyCode.CONTINUE_TESTING]: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: '⏳' },
  [MacroStrategyCode.FIX_LISTING]: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-300', icon: '📖' },
  [MacroStrategyCode.CUT_LOSERS]: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', icon: '✂️' },
  [MacroStrategyCode.NO_SIGNAL_YET]: { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200', icon: '🔍' },
};

// ── Execution type colors ───────────────────────────────────

export const TREND_COLORS: Record<TrendDirection, { bg: string; text: string; icon: string }> = {
  [TrendDirection.UP]: { bg: 'bg-emerald-50', text: 'text-emerald-600', icon: '↗' },
  [TrendDirection.STABLE]: { bg: 'bg-slate-50', text: 'text-slate-500', icon: '→' },
  [TrendDirection.DOWN]: { bg: 'bg-red-50', text: 'text-red-600', icon: '↘' },
};

export const EXECUTION_COLORS: Record<ActionExecution, { bg: string; text: string; icon: string }> = {
  ads: { bg: 'bg-blue-100', text: 'text-blue-800', icon: '⚡' },
  book: { bg: 'bg-orange-100', text: 'text-orange-800', icon: '📖' },
  none: { bg: 'bg-slate-100', text: 'text-slate-600', icon: '👁' },
};

// ── Render Functions ────────────────────────────────────────

function getConfidenceInfo(score: number): { label: string; level: 'high' | 'medium' | 'low' } {
  if (score >= 70) return { label: t('insights.confidence.high'), level: 'high' };
  if (score >= 45) return { label: t('insights.confidence.medium'), level: 'medium' };
  return { label: t('insights.confidence.low'), level: 'low' };
}

function buildParams(facts: SummaryFacts): Record<string, string | number> {
  const remaining = Math.max(0, 15 - facts.clicks);
  return {
    impressions: facts.impressions.toLocaleString('fr-FR'),
    clicks: facts.clicks.toLocaleString('fr-FR'),
    ctr: facts.ctr !== null ? facts.ctr.toFixed(1) : '—',
    orders: facts.orders.toString(),
    cvr: facts.cvr !== null ? facts.cvr.toFixed(1) : '—',
    spend: facts.spend.toFixed(2),
    sales: facts.sales.toFixed(2),
    acos: facts.acos !== null ? facts.acos.toFixed(1) : '—',
    periodDays: facts.periodDays.toString(),
    minClicks: '15',
    remainingClicks: remaining.toString(),
    breakEven: '35',
  };
}

export function renderCampaignInsight(insight: CampaignInsight): RenderedCampaignStrategy {
  const template = CAMPAIGN_INSIGHT_TEMPLATES[insight.diagnosisCode];
  const params = buildParams(insight.summaryFacts);
  const conf = getConfidenceInfo(insight.confidenceScore);
  const ms = insight.macroStrategy;

  // Build strategy-specific params
  const strategyParams: Record<string, string | number> = {
    ...params,
    winnersCount: ms.winnersCount.toString(),
    boostCandidatesCount: ms.boostCandidatesCount.toString(),
    testingCount: ms.testingCount.toString(),
    ignoredCount: ms.ignoredCount.toString(),
    losersCount: ms.losersCount.toString(),
    expensiveCount: ms.expensiveCount.toString(),
    totalEntities: ms.totalEntities.toString(),
    eligibleCount: ms.eligibleCount.toString(),
  };

  const trendDir = insight.trendDirection || TrendDirection.STABLE;

  return {
    strategyTitle: t(`insights.strategy.${ms.macroStrategyCode}.title`, strategyParams),
    strategySummary: t(`insights.strategy.${ms.macroStrategyCode}.summary`, strategyParams),
    explanation: template ? t(template.explanationKey, params) : '',
    summaryText: template ? t(template.summaryKey, params) : '',
    confidenceLabel: conf.label,
    confidenceLevel: conf.level,
    trendLabel: t(`insights.trend.${trendDir}`),
    trendDirection: trendDir,
    periodLabel: t('insights.period.label', {
      days: (insight.strategicPeriodDays || params.periodDays).toString(),
    }),
  };
}

export function renderEntityInsight(insight: EntityInsight): RenderedInsight {
  const template = ENTITY_INSIGHT_TEMPLATES[insight.diagnosisCode];
  if (!template) {
    return {
      title: insight.diagnosisCode,
      badgeText: insight.diagnosisCode,
      explanation: '',
      summaryText: '',
      actions: [],
      confidenceLabel: '',
      confidenceLevel: 'low',
    };
  }

  const params = buildParams(insight.summaryFacts);
  const conf = getConfidenceInfo(insight.confidenceScore);

  return {
    title: t(template.titleKey, params),
    badgeText: template.badgeKey ? t(template.badgeKey, params) : t(template.titleKey, params),
    explanation: t(template.explanationKey, params),
    summaryText: t(template.summaryKey, params),
    nextStepText: template.nextStepKey ? t(template.nextStepKey, params) : undefined,
    actions: insight.suggestedActions.map(a => ({
      label: t(a.i18nKey),
      execution: a.execution,
      executionLabel: t(`insights.execution.${a.execution}`),
      type: a.type,
    })),
    confidenceLabel: conf.label,
    confidenceLevel: conf.level,
  };
}
