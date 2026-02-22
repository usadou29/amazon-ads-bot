'use client';

import { t } from '@/lib/i18n';
import {
  type CampaignInsight,
  renderCampaignInsight,
  CAMPAIGN_DIAGNOSIS_COLORS,
  MACRO_STRATEGY_COLORS,
  TREND_COLORS,
  TrendDirection,
} from '@/lib/transforms/insights';

interface CampaignInsightCardProps {
  insight: CampaignInsight;
}

export function CampaignInsightCard({ insight }: CampaignInsightCardProps) {
  const rendered = renderCampaignInsight(insight);
  const ms = insight.macroStrategy;
  const stratColors = MACRO_STRATEGY_COLORS[ms.macroStrategyCode] || {
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-200',
    icon: '🔍',
  };
  const diagColors = CAMPAIGN_DIAGNOSIS_COLORS[insight.diagnosisCode] || {
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-200',
  };

  const confidenceColors = {
    high: 'text-emerald-600',
    medium: 'text-amber-600',
    low: 'text-slate-400',
  };

  return (
    <div className={`mt-3 rounded-lg border ${stratColors.border} ${stratColors.bg} p-3`}>
      {/* Strategy header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">{stratColors.icon}</span>
          <h4 className={`text-sm font-semibold ${stratColors.text}`}>
            {rendered.strategyTitle}
          </h4>
          {/* Trend badge */}
          {(() => {
            const trendColors = TREND_COLORS[rendered.trendDirection] || TREND_COLORS[TrendDirection.STABLE];
            return (
              <span
                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${trendColors.bg} ${trendColors.text}`}
                title={insight.trendAnalysis
                  ? `ACoS strat: ${insight.trendAnalysis.strategicAcos ?? '—'}% → 7j: ${insight.trendAnalysis.trendAcos ?? '—'}% | CVR strat: ${insight.trendAnalysis.strategicCvr ?? '—'}% → 7j: ${insight.trendAnalysis.trendCvr ?? '—'}%`
                  : undefined
                }
              >
                {trendColors.icon} {rendered.trendLabel}
              </span>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400">
            {rendered.periodLabel}
          </span>
          <span
            className={`text-[10px] font-medium ${confidenceColors[rendered.confidenceLevel]}`}
            title={`Score de confiance : ${insight.confidenceScore}%`}
          >
            {rendered.confidenceLabel}
          </span>
        </div>
      </div>

      {/* Strategy summary */}
      <p className="mb-2 text-xs leading-relaxed text-slate-700">
        {rendered.strategySummary}
      </p>

      {/* Campaign diagnosis context */}
      <div className={`mb-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${diagColors.bg} ${diagColors.text} ${diagColors.border}`}>
        {rendered.summaryText}
      </div>

      {/* Entity distribution mini-bar */}
      {ms.totalEntities > 0 && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 flex-wrap">
            {ms.winnersCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">
                ✅ {ms.winnersCount} gagnant{ms.winnersCount > 1 ? 's' : ''}
              </span>
            )}
            {ms.boostCandidatesCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
                🚀 {ms.boostCandidatesCount} à potentiel
              </span>
            )}
            {ms.expensiveCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                ⚠️ {ms.expensiveCount} cher{ms.expensiveCount > 1 ? 's' : ''}
              </span>
            )}
            {ms.losersCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                ❌ {ms.losersCount} sans vente{ms.losersCount > 1 ? 's' : ''}
              </span>
            )}
            {ms.testingCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                ⏳ {ms.testingCount} en test
              </span>
            )}
            {ms.ignoredCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-slate-400">
                👁 {ms.ignoredCount} sans signal
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
