'use client';

import { useState } from 'react';
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
  campaignName?: string;
}

export function CampaignInsightCard({ insight, campaignName }: CampaignInsightCardProps) {
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
          {/* Trend badge — cliquable → popup explicative */}
          <CampaignTrendBadge
            trendDirection={rendered.trendDirection}
            trendLabel={rendered.trendLabel}
            trendAnalysis={insight.trendAnalysis}
            strategicPeriodDays={insight.strategicPeriodDays}
            campaignName={campaignName}
          />
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

// ── Campaign Trend Badge (cliquable) ──
function CampaignTrendBadge({
  trendDirection,
  trendLabel,
  trendAnalysis,
  strategicPeriodDays,
  campaignName,
}: {
  trendDirection: TrendDirection;
  trendLabel: string;
  trendAnalysis?: CampaignInsight['trendAnalysis'];
  strategicPeriodDays: number;
  campaignName?: string;
}) {
  const [open, setOpen] = useState(false);
  const trendColors = TREND_COLORS[trendDirection] || TREND_COLORS[TrendDirection.STABLE];

  return (
    <>
      <span
        className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium cursor-pointer hover:ring-2 transition-all ${trendColors.bg} ${trendColors.text} ${
          trendDirection === TrendDirection.DOWN ? 'hover:ring-red-300' :
          trendDirection === TrendDirection.UP ? 'hover:ring-emerald-300' :
          'hover:ring-slate-300'
        }`}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        {trendColors.icon} {trendLabel}
      </span>
      {open && (
        <CampaignTrendModal
          trendDirection={trendDirection}
          trendAnalysis={trendAnalysis}
          strategicPeriodDays={strategicPeriodDays}
          campaignName={campaignName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ── Campaign Trend Modal ──
function CampaignTrendModal({
  trendDirection,
  trendAnalysis,
  strategicPeriodDays,
  campaignName,
  onClose,
}: {
  trendDirection: TrendDirection;
  trendAnalysis?: CampaignInsight['trendAnalysis'];
  strategicPeriodDays: number;
  campaignName?: string;
  onClose: () => void;
}) {
  const name = campaignName ? `« ${campaignName} »` : 'cette campagne';
  const stratAcos = trendAnalysis?.strategicAcos;
  const trendAcos = trendAnalysis?.trendAcos;
  const stratCvr = trendAnalysis?.strategicCvr;
  const trendCvr = trendAnalysis?.trendCvr;

  const hasAcosData = stratAcos !== null && stratAcos !== undefined && trendAcos !== null && trendAcos !== undefined;
  const hasCvrData = stratCvr !== null && stratCvr !== undefined && trendCvr !== null && trendCvr !== undefined;
  const acosDelta = hasAcosData ? trendAcos - stratAcos : 0;
  const cvrDelta = hasCvrData ? trendCvr - stratCvr : 0;

  let icon: string;
  let title: string;
  let explanation: string;
  let accentBorder: string;
  let accentBg: string;
  let iconBg: string;

  if (trendDirection === TrendDirection.DOWN) {
    icon = '↘';
    title = 'Rentabilité en baisse';
    explanation = `La rentabilité de ${name} se dégrade sur les 7 derniers jours par rapport à la période stratégique (${strategicPeriodDays}j).`;
    if (hasAcosData) {
      explanation += `\n\nL'ACoS est passé de ${stratAcos.toFixed(1)}% à ${trendAcos.toFixed(1)}% (+${acosDelta.toFixed(1)} pts), ce qui signifie que tu paies plus cher par euro de vente.`;
    }
    if (hasCvrData) {
      const cvrWord = cvrDelta < 0 ? 'a baissé' : 'a augmenté';
      explanation += `\n\nLe taux de conversion ${cvrWord} de ${stratCvr.toFixed(1)}% à ${trendCvr.toFixed(1)}%.`;
    }
    explanation += '\n\nSi la tendance continue, envisage de baisser les enchères sur les mots-clés les moins performants de cette campagne.';
    accentBorder = 'border-l-red-500';
    accentBg = 'bg-red-50';
    iconBg = 'bg-red-100 text-red-600';
  } else if (trendDirection === TrendDirection.UP) {
    icon = '↗';
    title = 'Rentabilité en hausse';
    explanation = `La rentabilité de ${name} s'améliore sur les 7 derniers jours par rapport à la période stratégique (${strategicPeriodDays}j).`;
    if (hasAcosData) {
      explanation += `\n\nL'ACoS est passé de ${stratAcos.toFixed(1)}% à ${trendAcos.toFixed(1)}% (${acosDelta.toFixed(1)} pts), ce qui signifie que tu paies moins cher par euro de vente.`;
    }
    if (hasCvrData) {
      const cvrWord = cvrDelta > 0 ? 'a augmenté' : 'a baissé';
      explanation += `\n\nLe taux de conversion ${cvrWord} de ${stratCvr.toFixed(1)}% à ${trendCvr.toFixed(1)}%.`;
    }
    explanation += '\n\nBonne dynamique — tu peux maintenir ou prudemment augmenter les enchères pour capter plus de volume.';
    accentBorder = 'border-l-emerald-500';
    accentBg = 'bg-emerald-50';
    iconBg = 'bg-emerald-100 text-emerald-600';
  } else {
    icon = '→';
    title = 'Rentabilité stable';
    explanation = `La rentabilité de ${name} est stable entre la période stratégique (${strategicPeriodDays}j) et les 7 derniers jours.`;
    if (hasAcosData) {
      explanation += `\n\nL'ACoS est à ${trendAcos.toFixed(1)}% (vs ${stratAcos.toFixed(1)}% sur ${strategicPeriodDays}j).`;
    }
    explanation += '\n\nPas de changement nécessaire pour le moment.';
    accentBorder = 'border-l-slate-400';
    accentBg = 'bg-slate-50';
    iconBg = 'bg-slate-100 text-slate-600';
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className={`relative bg-white rounded-xl shadow-2xl border border-slate-200 w-[380px] max-w-[90vw] overflow-hidden border-l-4 ${accentBorder}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center gap-3 px-5 py-4 ${accentBg}`}>
          <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-lg font-bold ${iconBg}`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{campaignName || 'Campagne'}</p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full hover:bg-black/10 text-slate-400 hover:text-slate-600 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Chiffres comparatifs */}
        {(hasAcosData || hasCvrData) && (
          <div className="px-5 py-3 border-b border-slate-100">
            <div className="grid grid-cols-2 gap-3">
              {hasAcosData && (
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">ACoS</p>
                  <div className="flex items-center justify-center gap-1.5 mt-1">
                    <span className="text-sm text-slate-500">{stratAcos.toFixed(1)}%</span>
                    <span className="text-xs text-slate-400">→</span>
                    <span className={`text-sm font-semibold ${acosDelta > 0 ? 'text-red-600' : acosDelta < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                      {trendAcos.toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">{strategicPeriodDays}j → 7j</p>
                </div>
              )}
              {hasCvrData && (
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">CVR</p>
                  <div className="flex items-center justify-center gap-1.5 mt-1">
                    <span className="text-sm text-slate-500">{stratCvr.toFixed(1)}%</span>
                    <span className="text-xs text-slate-400">→</span>
                    <span className={`text-sm font-semibold ${cvrDelta > 0 ? 'text-emerald-600' : cvrDelta < 0 ? 'text-red-600' : 'text-slate-600'}`}>
                      {trendCvr.toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">{strategicPeriodDays}j → 7j</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Explication */}
        <div className="px-5 py-4">
          {explanation.split('\n\n').map((paragraph, i) => (
            <p key={i} className={`text-[13px] leading-relaxed text-slate-600 ${i > 0 ? 'mt-3' : ''}`}>
              {paragraph}
            </p>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
          <p className="text-[11px] text-slate-400">
            Comparaison ACoS sur {strategicPeriodDays}j (période stratégique) vs les 7 derniers jours.
          </p>
        </div>
      </div>
    </div>
  );
}
