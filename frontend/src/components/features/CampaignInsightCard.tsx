'use client';

import { t } from '@/lib/i18n';
import {
  type CampaignInsight,
  renderCampaignInsight,
  CAMPAIGN_DIAGNOSIS_COLORS,
  EXECUTION_COLORS,
} from '@/lib/transforms/insights';

interface CampaignInsightCardProps {
  insight: CampaignInsight;
}

export function CampaignInsightCard({ insight }: CampaignInsightCardProps) {
  const rendered = renderCampaignInsight(insight);
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
    <div className={`mt-3 rounded-lg border ${diagColors.border} ${diagColors.bg} p-3`}>
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <h4 className={`text-sm font-semibold ${diagColors.text}`}>
          {rendered.title}
        </h4>
        <span
          className={`text-[10px] font-medium ${confidenceColors[rendered.confidenceLevel]}`}
          title={`Score de confiance : ${insight.confidenceScore}%`}
        >
          {rendered.confidenceLabel}
        </span>
      </div>

      {/* Summary facts */}
      <p className="mb-2 text-xs text-slate-500">
        {rendered.summaryText}
      </p>

      {/* Explanation */}
      <p className="mb-3 text-xs leading-relaxed text-slate-700">
        {rendered.explanation}
      </p>

      {/* Actions */}
      {rendered.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {rendered.actions.map((action, i) => {
            const execColors = EXECUTION_COLORS[action.execution];
            return (
              <span
                key={`${action.type}-${i}`}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${execColors.bg} ${execColors.text}`}
              >
                <span>{execColors.icon}</span>
                <span>{action.label}</span>
                <span className="opacity-60">· {action.executionLabel}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
