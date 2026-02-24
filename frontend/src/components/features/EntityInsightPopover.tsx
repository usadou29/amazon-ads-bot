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
import { fetchEntityDiagnostic } from '@/lib/api/client';

interface EntityInsightPopoverProps {
  insight: EntityInsight;
  entityName: string;
}

// ── Types for diagnostic data ──
interface DailyRow {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
}

interface WindowAgg {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number | null;
  cvr: number | null;
  daysWithData: number;
  period: string;
}

interface DiagnosticData {
  windows: Record<string, WindowAgg>;
  rawDailyRows: DailyRow[];
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
      {/* Badge — clickable */}
      <button
        onClick={() => setIsOpen(true)}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap transition-colors hover:opacity-80 ${diagColors.bg} ${diagColors.text} ${diagColors.border}`}
        title={rendered.title}
      >
        {rendered.badgeText}
      </button>

      {/* Modal */}
      {isOpen && (
        <InsightModal
          insight={insight}
          entityName={entityName}
          rendered={rendered}
          diagColors={diagColors}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}

// ── Main Modal Component ──
function InsightModal({
  insight,
  entityName,
  rendered,
  diagColors,
  onClose,
}: {
  insight: EntityInsight;
  entityName: string;
  rendered: ReturnType<typeof renderEntityInsight>;
  diagColors: { bg: string; text: string; border: string };
  onClose: () => void;
}) {
  const [diagnostic, setDiagnostic] = useState<DiagnosticData | null>(null);
  const [loading, setLoading] = useState(true);

  // Extract amazonId from entityKey (format: "target:123456" or "keyword:789")
  const parts = insight.entityKey.split(':');
  const entityType = parts[0];
  const amazonId = parts.slice(1).join(':');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEntityDiagnostic(entityType, amazonId)
      .then((data) => { if (!cancelled) setDiagnostic(data); })
      .catch(() => { /* silently fail — we still show the insight without charts */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityType, amazonId]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="relative mx-4 w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 text-slate-400 hover:text-slate-600 transition-colors"
        >
          ✕
        </button>

        {/* ── 1. Header + Explication globale ── */}
        <div className="p-5 pb-3">
          <p className="mb-1 text-[11px] font-medium text-slate-400 truncate pr-6">
            {entityName}
          </p>
          <div className="mb-2 flex items-center gap-2">
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
          <p className="text-xs leading-relaxed text-slate-700">
            {rendered.explanation}
          </p>

          {/* Decision window info */}
          {insight.decisionPeriodDays && (
            <p className="mt-1.5 text-[10px] text-slate-400">
              Analyse sur {insight.decisionPeriodDays}j ({computeDateRange(insight.decisionPeriodDays)})
            </p>
          )}

          {/* Window divergence warning */}
          {insight.longWindowFacts && insight.summaryFacts.orders === 0 && insight.longWindowFacts.orders > 0 && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[10px] font-medium text-amber-700 mb-0.5">
                ⚠️ Divergence de fenêtres
              </p>
              <p className="text-[10px] text-amber-600">
                0 commande sur {insight.decisionPeriodDays}j — mais {insight.longWindowFacts.orders} commande{insight.longWindowFacts.orders > 1 ? 's' : ''} sur 30j{insight.longWindowFacts.acos !== null ? ` (ACoS ${insight.longWindowFacts.acos.toFixed(1)}%)` : ''}.
              </p>
            </div>
          )}
        </div>

        {/* ── 2. Courbes d'évolution ── */}
        <div className="px-5 pb-3 border-t border-slate-100 pt-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 mb-2">
            Évolution des performances
          </p>
          {loading ? (
            <div className="flex items-center justify-center py-6 text-xs text-slate-400">
              Chargement des données...
            </div>
          ) : diagnostic ? (
            <EvolutionCharts diagnostic={diagnostic} />
          ) : (
            <div className="flex items-center justify-center py-4 text-xs text-slate-400">
              Données non disponibles
            </div>
          )}
        </div>

        {/* ── 3. Mini metrics ── */}
        <div className="px-5 pb-3">
          <div className="grid grid-cols-4 gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <MiniMetric label="Impr." value={insight.summaryFacts.impressions.toLocaleString('fr-FR')} />
            <MiniMetric label="Clics" value={insight.summaryFacts.clicks.toString()} />
            <MiniMetric label="Cmd." value={insight.summaryFacts.orders.toString()} />
            <MiniMetric
              label="ACoS"
              value={insight.summaryFacts.acos !== null ? `${insight.summaryFacts.acos.toFixed(1)}%` : '—'}
            />
          </div>
        </div>

        {/* ── 4. Conseil ── */}
        {rendered.nextStepText && (
          <div className="px-5 pb-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 mb-1.5">
              Conseil
            </p>
            <div className="flex items-start gap-1.5 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
              <span className="text-xs mt-0.5">💡</span>
              <p className="text-xs text-blue-800 leading-relaxed">
                {rendered.nextStepText}
              </p>
            </div>
          </div>
        )}

        {/* ── 5. Actions recommandée + autres ── */}
        {rendered.actions.length > 0 && (() => {
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
            <div className="px-5 pb-4 space-y-2 border-t border-slate-100 pt-3">
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
          <div className="px-5 pb-4 border-t border-slate-100 pt-3">
            <p className="text-[11px] text-slate-400">
              Recommandation liée : {insight.linkedRecommendation.strategyLabel}
              {' '}(score {insight.linkedRecommendation.strategyScore})
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Y-axis tick helper for ACoS % ──
function computeAcosTicks(maxVal: number): number[] {
  // Nice round steps depending on range
  const candidates = [10, 20, 25, 50];
  const step = candidates.find(s => maxVal / s <= 6) || 50;
  const ticks: number[] = [];
  for (let v = 0; v <= maxVal; v += step) {
    ticks.push(v);
  }
  return ticks;
}

// ── Single Unified Rentabilité Chart with 7j / 14j / 30j zones ──
function EvolutionCharts({ diagnostic }: { diagnostic: DiagnosticData }) {
  const { rawDailyRows, windows } = diagnostic;

  // Sort rows by date ascending
  const sortedRows = [...rawDailyRows].sort((a, b) => a.date.localeCompare(b.date));
  if (sortedRows.length < 2) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-slate-400">
        Pas assez de données
      </div>
    );
  }

  // Compute rolling ACoS (7-day smoothing) = spend / sales * 100
  // 7-day window absorbs days with 0 sales without spiking the curve
  const values: { date: string; value: number }[] = [];
  for (let i = 0; i < sortedRows.length; i++) {
    let spend = 0;
    let sales = 0;
    const windowSize = Math.min(7, i + 1);
    for (let j = i - windowSize + 1; j <= i; j++) {
      if (j >= 0) {
        spend += sortedRows[j].spend;
        sales += sortedRows[j].sales;
      }
    }
    if (spend <= 0) continue; // skip days with no ad activity
    if (sales <= 0) continue; // skip if no sales at all in the 7-day window
    const acos = (spend / sales) * 100;
    values.push({ date: sortedRows[i].date, value: acos });
  }

  if (values.length < 2) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-slate-400">
        Pas assez de données
      </div>
    );
  }

  // ── SVG dimensions ──
  const width = 340;
  const height = 110;
  const pad = { top: 16, bottom: 20, left: 42, right: 4 };
  const cw = width - pad.left - pad.right;
  const ch = height - pad.top - pad.bottom;

  const rawMax = Math.max(...values.map(v => v.value));
  // Also consider window aggregate ACoS values so the Y scale covers everything
  const windowAcosValues = (['7d', '14d', '30d'] as const)
    .map(k => windows[k])
    .filter(w => w && w.sales > 0)
    .map(w => (w.spend / w.sales) * 100);
  const overallMax = Math.max(rawMax, ...windowAcosValues);
  // Y scale: 0 → enough headroom above the highest ACoS value
  const minVal = 0;
  const maxVal = Math.max(overallMax * 1.1, 20);
  const range = maxVal - minVal;

  // Y-axis percentage ticks
  const yTicks = computeAcosTicks(maxVal);

  // Y-axis inverted: low ACoS (good) at top, high ACoS (bad) at bottom
  const points = values.map((v, i) => ({
    x: pad.left + (i / (values.length - 1)) * cw,
    y: pad.top + ((v.value - minVal) / range) * ch,
    value: v.value,
    date: v.date,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  // Fill towards the top (good = low ACoS)
  const fillD = pathD + ` L ${points[points.length - 1].x.toFixed(1)} ${pad.top} L ${points[0].x.toFixed(1)} ${pad.top} Z`;

  // Color based on current ACoS vs 35% threshold
  const ACOS_THRESHOLD = 35;
  const currentAcos = values[values.length - 1].value;
  const isGood = currentAcos <= ACOS_THRESHOLD;
  const strokeColor = '#94a3b8'; // gris neutre pour le trait de la courbe
  const fillColor = isGood ? '#10b98115' : '#ef444430';

  // Threshold line Y position
  const thresholdY = pad.top + ((ACOS_THRESHOLD - minVal) / range) * ch;

  // ── Zone separators: find index where 7d and 14d start ──
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const cutoff7d = new Date(yesterday);
  cutoff7d.setDate(cutoff7d.getDate() - 6);
  const cutoff14d = new Date(yesterday);
  cutoff14d.setDate(cutoff14d.getDate() - 13);
  const cutoff7dStr = cutoff7d.toISOString().split('T')[0];
  const cutoff14dStr = cutoff14d.toISOString().split('T')[0];

  // Find the closest point index for each cutoff
  const idx7d = values.findIndex(v => v.date >= cutoff7dStr);
  const idx14d = values.findIndex(v => v.date >= cutoff14dStr);

  const separators: { idx: number; label: string }[] = [];
  if (idx14d > 0 && idx14d < values.length - 1) separators.push({ idx: idx14d, label: '14j' });
  if (idx7d > 0 && idx7d < values.length - 1) separators.push({ idx: idx7d, label: '7j' });

  const lastPoint = points[points.length - 1];

  // Window summaries for legend
  const windowKeys = ['7d', '14d', '30d'] as const;
  const availableWindows = windowKeys
    .map(k => ({ key: k, w: windows[k] }))
    .filter(({ w }) => w && w.daysWithData >= 1 && w.sales > 0);

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2.5">
      {/* Chart title */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-slate-600">Évolution ACoS (coût pub / ventes)</span>
        <span className="text-[10px] text-slate-400">{values.length}j de données</span>
      </div>

      {/* SVG Chart */}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        {/* Y-axis percentage ticks + horizontal grid lines (inverted: 0% at top) */}
        {yTicks.map((tick) => {
          const y = pad.top + ((tick - minVal) / range) * ch;
          return (
            <g key={tick}>
              <line
                x1={pad.left}
                y1={y}
                x2={width - pad.right}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="0.5"
              />
              <text
                x={pad.left - 4}
                y={y + 3}
                fontSize="8"
                fill="#94a3b8"
                textAnchor="end"
                fontWeight="500"
              >
                {tick}%
              </text>
            </g>
          );
        })}

        {/* Green zone (ACoS < 35%) and red zone (ACoS > 35%) backgrounds */}
        <rect x={pad.left} y={pad.top} width={cw} height={thresholdY - pad.top} fill="#10b981" opacity={0.07} />
        <rect x={pad.left} y={thresholdY} width={cw} height={pad.top + ch - thresholdY} fill="#ef4444" opacity={0.18} />

        {/* 35% threshold line */}
        <line
          x1={pad.left} y1={thresholdY}
          x2={width - pad.right} y2={thresholdY}
          stroke="#94a3b8" strokeWidth="0.8" strokeDasharray="4,3"
        />
        <text x={pad.left - 4} y={thresholdY + 3} fontSize="8" fill="#64748b" textAnchor="end" fontWeight="600">
          35%
        </text>

        {/* Zone backgrounds */}
        {idx7d > 0 && (
          <rect
            x={points[idx7d].x}
            y={pad.top - 2}
            width={lastPoint.x - points[idx7d].x + pad.right}
            height={ch + 4}
            fill="#dbeafe20"
            rx="2"
          />
        )}

        {/* Separator lines */}
        {separators.map(({ idx, label }) => (
          <g key={label}>
            <line
              x1={points[idx].x}
              y1={pad.top - 2}
              x2={points[idx].x}
              y2={pad.top + ch + 2}
              stroke="#cbd5e1"
              strokeWidth="0.8"
              strokeDasharray="3,2"
            />
            <text
              x={points[idx].x + 3}
              y={pad.top + ch + 14}
              fontSize="8"
              fill="#94a3b8"
              fontWeight="500"
            >
              {label}
            </text>
          </g>
        ))}

        {/* "30j" label at start */}
        <text x={pad.left + 2} y={pad.top + ch + 14} fontSize="8" fill="#94a3b8" fontWeight="500">
          30j
        </text>
        {/* "Hier" label at end */}
        <text x={lastPoint.x} y={pad.top + ch + 14} fontSize="8" fill="#94a3b8" fontWeight="500" textAnchor="end">
          Hier
        </text>

        {/* Area fill */}
        <path d={fillD} fill={fillColor} />
        {/* Line */}
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

        {/* Start dot */}
        <circle cx={points[0].x} cy={points[0].y} r="2" fill="#94a3b8" />

        {/* End dot + current value label */}
        <circle cx={lastPoint.x} cy={lastPoint.y} r="3" fill={strokeColor} />
        <text
          x={lastPoint.x - 4}
          y={Math.max(pad.top + 4, lastPoint.y - 6)}
          fontSize="10"
          fill={strokeColor}
          fontWeight="700"
          textAnchor="end"
        >
          {lastPoint.value.toFixed(1)}%
        </text>

        {/* Separator dots on the line */}
        {separators.map(({ idx, label }) => (
          <circle key={`dot-${label}`} cx={points[idx].x} cy={points[idx].y} r="2" fill="#94a3b8" />
        ))}
      </svg>

      {/* Window summaries row */}
      {availableWindows.length > 0 && (
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {availableWindows.map(({ key, w }) => {
            const acos = (w.spend / w.sales) * 100;
            const color = acos <= 30 ? 'text-emerald-600' : acos <= 50 ? 'text-amber-600' : 'text-red-500';
            return (
              <div key={key} className="flex items-center gap-1.5 text-[10px]">
                <span className="text-slate-400 font-medium">{key.replace('d', 'j')} :</span>
                <span className={`font-semibold ${color}`}>{acos.toFixed(0)}%</span>
                <span className="text-slate-300">|</span>
                <span className="text-slate-400">{w.spend.toFixed(1)}€ dép.</span>
                <span className="text-slate-400">/ {w.sales.toFixed(1)}€ ventes</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
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
