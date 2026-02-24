'use client';

import { useState, useEffect } from 'react';
import { t } from '@/lib/i18n';
import {
  type EntityInsight,
  renderEntityInsight,
  ENTITY_DIAGNOSIS_COLORS,
  EXECUTION_COLORS,
  computeDateRange,
} from '@/lib/transforms/insights';
import { selectDefaultAction, insightActionToSuggestionItem } from '@/lib/action-selection';

interface EntityInsightPopoverProps {
  insight: EntityInsight;
  entityName: string;
}

export function EntityInsightPopover({
  insight,
  entityName,
}: EntityInsightPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  const rendered = renderEntityInsight(insight);
  const diagColors = ENTITY_DIAGNOSIS_COLORS[insight.diagnosisCode] || {
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-300',
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  return (
    <>
      {/* Badge — clickable, short label for table display */}
      <button
        onClick={() => setIsOpen(true)}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap transition-colors hover:opacity-80 ${diagColors.bg} ${diagColors.text} ${diagColors.border}`}
        title={rendered.title}
      >
        {rendered.badgeText}
      </button>

      {/* Modal overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative mx-4 w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setIsOpen(false)}
              className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 transition-colors"
            >
              ✕
            </button>

            {/* Entity name */}
            <p className="mb-1 text-[11px] font-medium text-slate-400 truncate pr-6">
              {entityName}
            </p>

            {/* Header */}
            <div className="mb-3 flex items-center gap-2">
              <h5 className={`text-sm font-semibold ${diagColors.text}`}>
                {rendered.title}
              </h5>
              <span className={`text-[10px] ${
                rendered.confidenceLevel === 'high' ? 'text-emerald-600'
                : rendered.confidenceLevel === 'medium' ? 'text-amber-600'
                : 'text-slate-400'
              }`}>
                {rendered.confidenceLabel}
              </span>
            </div>

            {/* Summary */}
            <p className="mb-2 text-xs text-slate-500">
              {rendered.summaryText}
            </p>

            {/* Explanation */}
            <p className="mb-2 text-xs leading-relaxed text-slate-700">
              {rendered.explanation}
            </p>

            {/* Next step */}
            {rendered.nextStepText && (
              <div className="mb-3 flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-xs">👉</span>
                <p className="text-xs font-medium text-slate-700">
                  {rendered.nextStepText}
                </p>
              </div>
            )}

            {/* Decision window transparency */}
            {(insight.decisionPeriodDays || insight.validationApplied || insight.guardrailApplied) && (
              <div className="mb-2 space-y-0.5">
                {insight.decisionPeriodDays && (
                  <p className="text-[10px] text-slate-400">
                    Analyse sur {insight.decisionPeriodDays}j ({computeDateRange(insight.decisionPeriodDays)})
                  </p>
                )}
                {insight.validationApplied && (
                  <p className="text-[10px] text-amber-500 font-medium">
                    Ajustement 30j appliqu&eacute;
                  </p>
                )}
                {insight.guardrailApplied && insight.guardrailExplanation && (
                  <p className="text-[10px] text-blue-500 font-medium">
                    {insight.guardrailExplanation}
                  </p>
                )}
              </div>
            )}

            {/* Window divergence warning */}
            {insight.longWindowFacts && insight.summaryFacts.orders === 0 && insight.longWindowFacts.orders > 0 && (
              <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[10px] font-medium text-amber-700 mb-1">
                  ⚠️ Divergence de fenêtres
                </p>
                <p className="text-[10px] text-amber-600">
                  Sur {insight.decisionPeriodDays}j ({computeDateRange(insight.decisionPeriodDays!)}) : 0 commande — mais sur 30j ({computeDateRange(30)}) : {insight.longWindowFacts.orders} commande{insight.longWindowFacts.orders > 1 ? 's' : ''}{insight.longWindowFacts.acos !== null ? ` (ACoS ${insight.longWindowFacts.acos.toFixed(1)}%)` : ''}.
                  Ce mot-clé convertit sur la période longue.
                </p>
              </div>
            )}

            {/* Long window context (when orders exist on both windows but differ) */}
            {insight.longWindowFacts && insight.summaryFacts.orders > 0 && insight.longWindowFacts.orders > insight.summaryFacts.orders && (
              <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[10px] text-slate-500">
                  Sur 30j ({computeDateRange(30)}) : {insight.longWindowFacts.clicks} clics, {insight.longWindowFacts.orders} cmd.{insight.longWindowFacts.acos !== null ? `, ACoS ${insight.longWindowFacts.acos.toFixed(1)}%` : ''}
                </p>
              </div>
            )}

            {/* Mini metrics row */}
            <div className="mb-3 grid grid-cols-4 gap-2 border-t border-slate-100 pt-3">
              <MiniMetric label="Impr." value={insight.summaryFacts.impressions.toLocaleString('fr-FR')} />
              <MiniMetric label="Clics" value={insight.summaryFacts.clicks.toString()} />
              <MiniMetric label="Cmd." value={insight.summaryFacts.orders.toString()} />
              <MiniMetric
                label="ACoS"
                value={insight.summaryFacts.acos !== null ? `${insight.summaryFacts.acos.toFixed(1)}%` : '—'}
              />
            </div>

            {/* Actions — Recommandée + Autres */}
            {rendered.actions.length > 0 && (() => {
              // Convertir en ActionSuggestionItems pour le scoring
              const items = rendered.actions.map((a, i) =>
                insightActionToSuggestionItem(a, insight, i),
              );
              const best = selectDefaultAction(items, {
                diagnosisCode: insight.diagnosisCode,
                clicks: insight.summaryFacts.clicks,
              });
              const bestType = best?.actionType;
              const recommendedAction = rendered.actions.find(a => a.type === bestType);
              const otherActions = rendered.actions.filter(a => a.type !== bestType);

              return (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  {/* Action recommandée */}
                  {recommendedAction && (
                    <>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                        Action recommandée
                      </p>
                      <div className="flex items-center gap-2 text-xs rounded-lg bg-slate-50 px-2.5 py-2 border border-slate-100">
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${EXECUTION_COLORS[recommendedAction.execution].bg} ${EXECUTION_COLORS[recommendedAction.execution].text}`}>
                          {EXECUTION_COLORS[recommendedAction.execution].icon} {recommendedAction.executionLabel}
                        </span>
                        <span className="text-slate-700 font-medium">{recommendedAction.label}</span>
                        <span className="ml-auto text-[9px] font-semibold rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5">
                          Recommandée
                        </span>
                      </div>
                    </>
                  )}

                  {/* Autres options */}
                  {otherActions.length > 0 && (
                    <>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 mt-2">
                        Autres options
                      </p>
                      {otherActions.map((action, i) => {
                        const execColors = EXECUTION_COLORS[action.execution];
                        return (
                          <div
                            key={`${action.type}-${i}`}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${execColors.bg} ${execColors.text}`}>
                              {execColors.icon} {execColors.icon === '⚡' ? 'Action pub' : execColors.icon === '📖' ? 'Conseil livre' : 'Observation'}
                            </span>
                            <span className="text-slate-600">{action.label}</span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              );
            })()}

            {/* Linked recommendation */}
            {insight.linkedRecommendation && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-[11px] text-slate-400">
                  Recommandation liée : {insight.linkedRecommendation.strategyLabel}
                  {' '}(score {insight.linkedRecommendation.strategyScore})
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-xs font-medium text-slate-700">{value}</div>
    </div>
  );
}
