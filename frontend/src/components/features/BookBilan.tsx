'use client';
import React, { useMemo, useState } from 'react';
import { EntityInsight, EntityDiagnosisCode, ENTITY_DIAGNOSIS_COLORS } from '@/lib/transforms/insights';

// ══════════════════════════════════════════════════════════════
//  TYPES
// ══════════════════════════════════════════════════════════════

interface CampaignForBilan {
  id: string;
  name: string;
  state: string;
  keywords: Array<{ insight?: EntityInsight }>;
  productTargets: Array<{ insight?: EntityInsight }>;
}

interface BookBilanProps {
  campaigns: CampaignForBilan[];
}

// ── Catégorie humaine ────────────────────────────────────────

type HumanCategory = 'conversion' | 'visibility' | 'testing' | 'performing';

interface CategoryDefinition {
  key: HumanCategory;
  icon: string;
  label: string;
  shortLabel: string;
  diagnosisCodes: EntityDiagnosisCode[];
  /** Poids pour la priorisation (plus haut = plus urgent) */
  impactWeight: number;
}

interface CategoryResult {
  definition: CategoryDefinition;
  entityCount: number;
  pct: number;
  diagnosisBreakdown: Array<{ code: EntityDiagnosisCode; label: string; count: number }>;
  actions: Array<{ type: string; label: string; count: number }>;
  priority: 'high' | 'medium' | 'low';
}

type PriorityLevel = 'high' | 'medium' | 'low';

interface NarrativeResult {
  headline: string;
  detail: string;
}

// ══════════════════════════════════════════════════════════════
//  CONSTANTES
// ══════════════════════════════════════════════════════════════

const CATEGORIES: CategoryDefinition[] = [
  {
    key: 'conversion',
    icon: '🎯',
    label: 'Conversion',
    shortLabel: 'Conversion',
    diagnosisCodes: [
      EntityDiagnosisCode.CLICKS_NO_SALES,
      EntityDiagnosisCode.EXPENSIVE_BUT_VALID,
      EntityDiagnosisCode.ZERO_CLICKS, // vu mais ignoré = pb fiche/couverture = conversion au sens large
    ],
    impactWeight: 3,
  },
  {
    key: 'visibility',
    icon: '👀',
    label: 'Visibilité',
    shortLabel: 'Visibilité',
    diagnosisCodes: [
      EntityDiagnosisCode.NO_IMPRESSIONS,
      EntityDiagnosisCode.ZERO_CLICKS_LOW_VOLUME,
      EntityDiagnosisCode.VERY_LOW_CLICKS,
    ],
    impactWeight: 2,
  },
  {
    key: 'testing',
    icon: '🧪',
    label: 'En test',
    shortLabel: 'En test',
    diagnosisCodes: [
      EntityDiagnosisCode.LOW_CLICKS,
    ],
    impactWeight: 1,
  },
  {
    key: 'performing',
    icon: '🏆',
    label: 'Performants',
    shortLabel: 'Performants',
    diagnosisCodes: [
      EntityDiagnosisCode.WINNER,
      EntityDiagnosisCode.BOOST_CANDIDATE,
    ],
    impactWeight: 0,
  },
];

const DIAGNOSIS_LABELS: Record<string, string> = {
  no_impressions: 'Pas diffusé',
  zero_clicks_low_volume: 'Peu de visibilité',
  zero_clicks: 'Vu mais ignoré',
  very_low_clicks: 'Très peu de clics',
  low_clicks: 'Début de signal',
  clicks_no_sales: 'Clics sans ventes',
  expensive_but_valid: 'Rentable… tout juste',
  winner: 'Gagnant',
  boost_candidate: 'Potentiel de croissance',
};

const ACTION_LABELS: Record<string, string> = {
  bid_up: 'Augmenter l\'enchère',
  bid_down: 'Baisser l\'enchère',
  pause: 'Mettre en pause',
  harvest: 'Récolter en exact',
  add_negative: 'Bloquer ce terme',
  budget_increase: 'Augmenter le budget',
  improve_listing: 'Améliorer ta fiche livre',
  improve_cover: 'Revoir ta couverture',
  monitor: 'Surveiller',
  patience: 'Patienter',
};

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  bid_up: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  bid_down: { bg: 'bg-amber-50', text: 'text-amber-700' },
  pause: { bg: 'bg-red-50', text: 'text-red-700' },
  harvest: { bg: 'bg-blue-50', text: 'text-blue-700' },
  add_negative: { bg: 'bg-red-50', text: 'text-red-600' },
  budget_increase: { bg: 'bg-blue-50', text: 'text-blue-700' },
  improve_listing: { bg: 'bg-orange-50', text: 'text-orange-700' },
  improve_cover: { bg: 'bg-orange-50', text: 'text-orange-700' },
  monitor: { bg: 'bg-slate-50', text: 'text-slate-600' },
  patience: { bg: 'bg-slate-50', text: 'text-slate-500' },
};

const PRIORITY_CONFIG: Record<PriorityLevel, { dot: string; label: string; border: string; bg: string; text: string }> = {
  high:   { dot: 'bg-red-500',    label: 'Priorité haute',   border: 'border-red-200',   bg: 'bg-red-50',    text: 'text-red-700' },
  medium: { dot: 'bg-amber-400',  label: 'Priorité moyenne', border: 'border-amber-200', bg: 'bg-amber-50',  text: 'text-amber-700' },
  low:    { dot: 'bg-emerald-400', label: 'À surveiller',    border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-700' },
};

const CATEGORY_BORDER: Record<HumanCategory, string> = {
  conversion: 'border-l-red-400',
  visibility: 'border-l-amber-400',
  testing: 'border-l-blue-300',
  performing: 'border-l-emerald-400',
};

// ══════════════════════════════════════════════════════════════
//  LOGIQUE MÉTIER (100% déterministe)
// ══════════════════════════════════════════════════════════════

/** Associe chaque diagnosisCode à sa catégorie humaine */
function codeToCategoryKey(code: EntityDiagnosisCode): HumanCategory {
  for (const cat of CATEGORIES) {
    if ((cat.diagnosisCodes as string[]).includes(code)) return cat.key;
  }
  return 'testing'; // fallback
}

/** Calcule la priorité d'une catégorie en fonction de son poids et de sa part */
function computePriority(pct: number, impactWeight: number): PriorityLevel {
  // Les performants sont toujours "low" (bonne nouvelle)
  if (impactWeight === 0) return 'low';
  const score = pct * impactWeight;
  if (score >= 60) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/**
 * Génère une synthèse narrative déterministe basée sur la distribution des catégories.
 */
function generateCampaignNarrative(
  categoryResults: CategoryResult[],
  totalEntities: number,
): NarrativeResult {
  if (totalEntities === 0) {
    return { headline: '', detail: '' };
  }

  // Trouver la catégorie dominante (hors performing)
  const problemCategories = categoryResults.filter(c => c.definition.key !== 'performing');
  const dominant = problemCategories.length > 0
    ? problemCategories.reduce((a, b) => (a.pct * a.definition.impactWeight) >= (b.pct * b.definition.impactWeight) ? a : b)
    : null;

  const performing = categoryResults.find(c => c.definition.key === 'performing');
  const performingPct = performing?.pct || 0;

  // Cas : majorité performante
  if (performingPct >= 50) {
    const detail = problemCategories.filter(c => c.entityCount > 0).length > 0
      ? `Quelques points d'attention restent à traiter sur le reste de tes mots-clés.`
      : `Continue comme ça.`;
    return {
      headline: `Bonne nouvelle : la majorité de tes mots-clés sont rentables ou en croissance.`,
      detail,
    };
  }

  if (!dominant || dominant.entityCount === 0) {
    return {
      headline: `Tes campagnes sont en cours d'analyse.`,
      detail: `Pas encore assez de données pour identifier une tendance claire.`,
    };
  }

  const dominantKey = dominant.definition.key;
  const dominantPct = dominant.pct;

  // Conversion dominant
  if (dominantKey === 'conversion') {
    if (dominantPct >= 60) {
      return {
        headline: `La majorité de tes campagnes attirent des clics, mais ne génèrent pas assez de ventes.`,
        detail: `Le principal enjeu est la conversion. Concentre-toi sur ta fiche livre (description, couverture, avis).`,
      };
    }
    return {
      headline: `Une bonne partie de tes mots-clés attirent du trafic sans convertir.`,
      detail: `Améliorer ta fiche livre pourrait débloquer des ventes sur ces termes.`,
    };
  }

  // Visibilité dominant
  if (dominantKey === 'visibility') {
    if (dominantPct >= 60) {
      return {
        headline: `Tes campagnes manquent surtout de visibilité.`,
        detail: `Peu de lecteurs voient ton livre pour l'instant. Des enchères plus hautes ou un ciblage plus large pourraient aider.`,
      };
    }
    return {
      headline: `Une partie importante de tes mots-clés ne reçoivent pas assez de trafic.`,
      detail: `Augmenter les enchères sur les termes les plus pertinents te donnera plus de données.`,
    };
  }

  // Testing dominant
  if (dominantKey === 'testing') {
    return {
      headline: `Tes campagnes sont en phase d'apprentissage.`,
      detail: `On accumule des données. Il est encore trop tôt pour tirer des conclusions — patience.`,
    };
  }

  // Mixte (aucun ne domine clairement)
  const topTwo = problemCategories.filter(c => c.entityCount > 0).slice(0, 2);
  if (topTwo.length >= 2 && Math.abs(topTwo[0].pct - topTwo[1].pct) < 15) {
    return {
      headline: `Tes campagnes présentent un mélange de signaux.`,
      detail: `À la fois des problèmes de ${topTwo[0].definition.label.toLowerCase()} et de ${topTwo[1].definition.label.toLowerCase()}. Traite-les par priorité.`,
    };
  }

  return {
    headline: `Tes campagnes sont en cours d'optimisation.`,
    detail: `Plusieurs axes d'amélioration identifiés — consulte le détail ci-dessous.`,
  };
}

// ══════════════════════════════════════════════════════════════
//  COMPOSANT PRINCIPAL
// ══════════════════════════════════════════════════════════════

export function BookBilan({ campaigns }: BookBilanProps) {
  const [showTechnicalDetail, setShowTechnicalDetail] = useState(false);

  const { categoryResults, totalEntities, narrative, allDiagnosisCounts } = useMemo(() => {
    // ── 1. Collecter les données brutes ──
    const diagMap = new Map<string, number>();
    const actMapByCategory = new Map<HumanCategory, Map<string, number>>();
    let total = 0;

    const activeCampaigns = campaigns.filter(
      c => c.state === 'ENABLED' || c.state === 'enabled',
    );

    for (const camp of activeCampaigns) {
      const entities = [...camp.keywords, ...camp.productTargets];
      for (const entity of entities) {
        if (!entity.insight) continue;
        total++;

        const code = entity.insight.diagnosisCode;
        diagMap.set(code, (diagMap.get(code) || 0) + 1);

        const catKey = codeToCategoryKey(code);
        if (!actMapByCategory.has(catKey)) actMapByCategory.set(catKey, new Map());
        const catActions = actMapByCategory.get(catKey)!;
        for (const action of entity.insight.suggestedActions) {
          catActions.set(action.type, (catActions.get(action.type) || 0) + 1);
        }
      }
    }

    // ── 2. Construire les résultats par catégorie ──
    const categoryResults: CategoryResult[] = CATEGORIES.map(def => {
      let entityCount = 0;
      const diagBreakdown: Array<{ code: EntityDiagnosisCode; label: string; count: number }> = [];

      for (const code of def.diagnosisCodes) {
        const count = diagMap.get(code) || 0;
        entityCount += count;
        if (count > 0) {
          diagBreakdown.push({ code, label: DIAGNOSIS_LABELS[code] || code, count });
        }
      }

      diagBreakdown.sort((a, b) => b.count - a.count);

      const pct = total > 0 ? Math.round((entityCount / total) * 100) : 0;

      const catActions = actMapByCategory.get(def.key);
      const actions: Array<{ type: string; label: string; count: number }> = [];
      if (catActions) {
        catActions.forEach((count, type) => {
          actions.push({ type, label: ACTION_LABELS[type] || type, count });
        });
        actions.sort((a, b) => b.count - a.count);
      }

      return {
        definition: def,
        entityCount,
        pct,
        diagnosisBreakdown: diagBreakdown,
        actions,
        priority: computePriority(pct, def.impactWeight),
      };
    }).filter(c => c.entityCount > 0);

    // Trier par priorité (high first) puis par pct
    const priorityOrder: Record<PriorityLevel, number> = { high: 0, medium: 1, low: 2 };
    categoryResults.sort((a, b) => {
      const po = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (po !== 0) return po;
      return b.pct - a.pct;
    });

    // ── 3. Préparer la liste technique (pour le détail déplié) ──
    const allDiagnosisCounts = Array.from(diagMap.entries())
      .map(([code, count]) => ({
        code: code as EntityDiagnosisCode,
        label: DIAGNOSIS_LABELS[code] || code,
        count,
        pct: total > 0 ? Math.round((count / total) * 100) : 0,
        colors: ENTITY_DIAGNOSIS_COLORS[code] || { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
      }))
      .sort((a, b) => b.count - a.count);

    // ── 4. Narrative ──
    const narrative = generateCampaignNarrative(categoryResults, total);

    return { categoryResults, totalEntities: total, narrative, allDiagnosisCounts };
  }, [campaigns]);

  if (totalEntities === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* ═══ Synthèse narrative ═══ */}
      <div className="px-5 pt-5 pb-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-0.5">
          Bilan de tes campagnes
        </h3>
        <p className="text-xs text-slate-400 mb-3">
          {totalEntities} mot{totalEntities > 1 ? 's' : ''}-clé{totalEntities > 1 ? 's' : ''} / ciblage{totalEntities > 1 ? 's' : ''} analysé{totalEntities > 1 ? 's' : ''}
        </p>

        <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
          <p className="text-sm font-medium text-slate-800 leading-snug">
            {narrative.headline}
          </p>
          {narrative.detail && (
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              {narrative.detail}
            </p>
          )}
        </div>
      </div>

      {/* ═══ Catégories regroupées avec actions ═══ */}
      <div className="px-5 pb-4 space-y-3">
        {categoryResults.map(cat => {
          const prioConf = PRIORITY_CONFIG[cat.priority];
          const borderLeft = CATEGORY_BORDER[cat.definition.key];

          return (
            <div
              key={cat.definition.key}
              className={`rounded-lg border border-slate-100 ${borderLeft} border-l-[3px] bg-white overflow-hidden`}
            >
              {/* En-tête catégorie */}
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base flex-shrink-0">{cat.definition.icon}</span>
                  <span className="text-sm font-medium text-slate-800 truncate">
                    {cat.definition.label}
                  </span>
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {cat.entityCount} ({cat.pct}%)
                  </span>
                </div>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${prioConf.bg} ${prioConf.text} ${prioConf.border} border`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${prioConf.dot}`} />
                  {prioConf.label}
                </span>
              </div>

              {/* Diagnostics + Actions */}
              <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                {/* Diagnostics de cette catégorie */}
                <div>
                  {cat.diagnosisBreakdown.map(d => (
                    <div key={d.code} className="flex items-center justify-between py-0.5">
                      <span className="text-xs text-slate-500">{d.label}</span>
                      <span className="text-xs text-slate-400 tabular-nums">{d.count}</span>
                    </div>
                  ))}
                </div>
                {/* Actions associées */}
                <div>
                  {cat.actions.length > 0 ? (
                    cat.actions.map(a => {
                      const colors = ACTION_COLORS[a.type] || { bg: 'bg-slate-50', text: 'text-slate-600' };
                      return (
                        <div key={a.type} className="flex items-center gap-1.5 py-0.5">
                          <span className="text-xs text-slate-400">→</span>
                          <span className={`inline-flex items-center px-1.5 py-px rounded text-[11px] font-medium ${colors.bg} ${colors.text}`}>
                            {a.label}
                          </span>
                          <span className="text-[11px] text-slate-400 tabular-nums">×{a.count}</span>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-slate-300 italic py-0.5">Aucune action</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ Détail technique (dépliable) ═══ */}
      <div className="border-t border-slate-100">
        <button
          onClick={() => setShowTechnicalDetail(prev => !prev)}
          className="w-full flex items-center justify-between px-5 py-2.5 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <span>Détail technique</span>
          <svg
            className={`w-3.5 h-3.5 transition-transform ${showTechnicalDetail ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showTechnicalDetail && (
          <div className="px-5 pb-4 space-y-2">
            {allDiagnosisCounts.map(d => {
              return (
                <div key={d.code} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-xs font-medium ${d.colors.text}`}>{d.label}</span>
                      <span className="text-xs text-slate-400 ml-2 flex-shrink-0 tabular-nums">
                        {d.count} ({d.pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${d.pct}%`, backgroundColor: getBarColor(d.code) }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════

function getBarColor(code: string): string {
  switch (code) {
    case 'winner': return '#059669';
    case 'boost_candidate': return '#2563eb';
    case 'expensive_but_valid': return '#d97706';
    case 'clicks_no_sales': return '#dc2626';
    case 'zero_clicks': return '#f59e0b';
    case 'low_clicks': return '#3b82f6';
    case 'very_low_clicks': return '#94a3b8';
    case 'zero_clicks_low_volume': return '#cbd5e1';
    case 'no_impressions': return '#94a3b8';
    default: return '#94a3b8';
  }
}
