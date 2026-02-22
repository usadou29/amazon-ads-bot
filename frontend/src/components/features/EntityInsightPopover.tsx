'use client';

import { useState, useRef, useEffect } from 'react';
import { t } from '@/lib/i18n';
import {
  type EntityInsight,
  renderEntityInsight,
  ENTITY_DIAGNOSIS_COLORS,
  EXECUTION_COLORS,
} from '@/lib/transforms/insights';

interface EntityInsightPopoverProps {
  insight: EntityInsight;
  entityName: string;
}

export function EntityInsightPopover({ insight, entityName }: EntityInsightPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const rendered = renderEntityInsight(insight);
  const diagColors = ENTITY_DIAGNOSIS_COLORS[insight.diagnosisCode] || {
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    border: 'border-slate-300',
  };

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  return (
    <div className="relative" ref={popoverRef}>
      {/* Badge — clickable */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors hover:opacity-80 ${diagColors.bg} ${diagColors.text} ${diagColors.border}`}
        title={rendered.title}
      >
        {rendered.title}
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          {/* Header */}
          <div className="mb-2 flex items-center justify-between">
            <h5 className={`text-xs font-semibold ${diagColors.text}`}>
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
          <p className="mb-1.5 text-[11px] text-slate-500">
            {rendered.summaryText}
          </p>

          {/* Explanation */}
          <p className="mb-2.5 text-[11px] leading-relaxed text-slate-700">
            {rendered.explanation}
          </p>

          {/* Mini metrics row */}
          <div className="mb-2.5 grid grid-cols-4 gap-1 border-t border-slate-100 pt-2">
            <MiniMetric label="Impr." value={insight.summaryFacts.impressions.toLocaleString('fr-FR')} />
            <MiniMetric label="Clics" value={insight.summaryFacts.clicks.toString()} />
            <MiniMetric label="Cmd." value={insight.summaryFacts.orders.toString()} />
            <MiniMetric
              label="ACoS"
              value={insight.summaryFacts.acos !== null ? `${insight.summaryFacts.acos.toFixed(1)}%` : '—'}
            />
          </div>

          {/* Actions */}
          {rendered.actions.length > 0 && (
            <div className="space-y-1.5 border-t border-slate-100 pt-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Actions suggérées
              </p>
              {rendered.actions.map((action, i) => {
                const execColors = EXECUTION_COLORS[action.execution];
                return (
                  <div
                    key={`${action.type}-${i}`}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${execColors.bg} ${execColors.text}`}>
                      {execColors.icon} {action.executionLabel}
                    </span>
                    <span className="text-slate-700">{action.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Linked recommendation */}
          {insight.linkedRecommendation && (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <p className="text-[10px] text-slate-400">
                Recommendation liée : {insight.linkedRecommendation.strategyLabel}
                {' '}(score {insight.linkedRecommendation.strategyScore})
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-[11px] font-medium text-slate-700">{value}</div>
    </div>
  );
}
