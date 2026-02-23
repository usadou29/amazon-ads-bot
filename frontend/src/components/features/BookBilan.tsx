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
//  DIAGNOSTIC EXPERT GLOBAL
// ══════════════════════════════════════════════════════════════

interface GlobalExpertSummary {
  headline: string;
  explanation: string;
  priorityFocus: 'conversion' | 'visibility' | 'learning';
}

interface ExpertSummaryInput {
  visibilityPercent: number;
  conversionPercent: number;
  performingPercent: number;
  testingPercent: number;
  diagnosticsCounts: {
    total: number;
    clicksNoSales: number;
    noImpressions: number;
    winners: number;
    boostCandidates: number;
  };
  lifecyclePhase?: string;
}

/**
 * Génère un diagnostic expert compréhensible par un auteur KDP.
 * 100% déterministe — aucun appel IA externe.
 *
 * Logique :
 *  1. Si peu de données (< 5 entités) → apprentissage
 *  2. Si conversion% >= visibility% et conversion% > 20% → pb conversion
 *  3. Si visibility% > conversion% et visibility% > 20% → pb visibilité
 *  4. Si les deux sont faibles ou équilibrés → apprentissage
 *  5. Override : si > 50% performants → féliciter
 */
export function generateGlobalExpertSummary(input: ExpertSummaryInput): GlobalExpertSummary {
  const {
    visibilityPercent,
    conversionPercent,
    performingPercent,
    testingPercent,
    diagnosticsCounts,
    lifecyclePhase,
  } = input;

  const total = diagnosticsCounts.total;

  // ── Cas 0 : pas de données ──
  if (total === 0) {
    return {
      headline: 'Aucune donnée de campagne disponible.',
      explanation: 'Lance tes premières campagnes pour obtenir un diagnostic.',
      priorityFocus: 'learning',
    };
  }

  // ── Cas 1 : trop peu d'entités pour conclure ──
  if (total < 5) {
    return {
      headline: 'Tes campagnes démarrent — on collecte les premières données.',
      explanation: `Avec seulement ${total} ciblage${total > 1 ? 's' : ''} analysé${total > 1 ? 's' : ''}, c'est encore trop tôt pour tirer des conclusions. Laisse tourner quelques jours.`,
      priorityFocus: 'learning',
    };
  }

  // ── Cas 2 : majorité performante (> 50%) ──
  if (performingPercent > 50) {
    const winnersTotal = diagnosticsCounts.winners + diagnosticsCounts.boostCandidates;
    if (conversionPercent > 15) {
      return {
        headline: `La majorité de tes ciblages sont rentables, mais ${conversionPercent}% présentent encore des problèmes de conversion.`,
        explanation: 'Tes campagnes tournent bien. Pour aller plus loin, concentre-toi sur les mots-clés qui génèrent des clics sans ventes — une amélioration de ta fiche livre pourrait débloquer ces derniers.',
        priorityFocus: 'conversion',
      };
    }
    return {
      headline: `Tes campagnes sont performantes : ${winnersTotal} ciblage${winnersTotal > 1 ? 's' : ''} rentable${winnersTotal > 1 ? 's' : ''}.`,
      explanation: 'Continue sur cette lancée. Surveille régulièrement les performances et augmente progressivement les enchères sur tes meilleurs mots-clés.',
      priorityFocus: 'visibility',
    };
  }

  // ── Cas 3 : conversion domine ──
  if (conversionPercent >= visibilityPercent && conversionPercent > 20) {
    const isLaunch = lifecyclePhase === 'launch';
    const clicksNoSales = diagnosticsCounts.clicksNoSales;

    if (conversionPercent >= 50) {
      return {
        headline: `Ton livre reçoit du trafic, mais plus de la moitié de tes ciblages ne convertissent pas.`,
        explanation: isLaunch
          ? `En phase de lancement, c'est normal d'avoir un taux de conversion bas. Mais avec ${clicksNoSales} mot${clicksNoSales > 1 ? 's' : ''}-clé${clicksNoSales > 1 ? 's' : ''} en "clics sans ventes", vérifie ta fiche livre : titre, description, couverture et prix.`
          : `Avant d'investir plus en publicité, améliore d'abord ta fiche livre (couverture, description, avis). ${clicksNoSales} ciblage${clicksNoSales > 1 ? 's' : ''} attirent des lecteurs qui repartent sans acheter.`,
        priorityFocus: 'conversion',
      };
    }

    return {
      headline: `${conversionPercent}% de tes ciblages attirent des clics mais ne génèrent pas de ventes.`,
      explanation: 'Le trafic est là, mais quelque chose freine l\'achat. Vérifie ta couverture, ta description et tes avis — c\'est souvent là que se joue la conversion.',
      priorityFocus: 'conversion',
    };
  }

  // ── Cas 4 : visibilité domine ──
  if (visibilityPercent > conversionPercent && visibilityPercent > 20) {
    const noImpressions = diagnosticsCounts.noImpressions;

    if (visibilityPercent >= 50) {
      return {
        headline: `Plus de la moitié de tes ciblages manquent de visibilité.`,
        explanation: noImpressions > 0
          ? `${noImpressions} mot${noImpressions > 1 ? 's' : ''}-clé${noImpressions > 1 ? 's' : ''} n'ont reçu aucune impression. Tes enchères sont probablement trop basses, ou ces termes sont trop compétitifs. Augmente progressivement les enchères sur les plus pertinents.`
          : 'Tes annonces apparaissent peu dans les résultats. Augmenter les enchères sur tes termes prioritaires te donnera plus de données pour optimiser.',
        priorityFocus: 'visibility',
      };
    }

    return {
      headline: `${visibilityPercent}% de tes ciblages ne reçoivent pas assez de trafic.`,
      explanation: 'Pour que tes campagnes puissent apprendre et s\'optimiser, elles ont besoin de visibilité. Augmente les enchères sur les termes les plus pertinents pour ton livre.',
      priorityFocus: 'visibility',
    };
  }

  // ── Cas 5 : phase d'apprentissage (testing élevé ou équilibre) ──
  if (testingPercent >= 30) {
    return {
      headline: 'Tes campagnes accumulent des données — c\'est la phase d\'apprentissage.',
      explanation: `${testingPercent}% de tes ciblages sont en cours de test. Dans quelques jours, on aura assez de clics pour savoir lesquels convertissent et ajuster les enchères.`,
      priorityFocus: 'learning',
    };
  }

  // ── Cas 6 : mixte ou équilibre (fallback) ──
  if (conversionPercent > 0 && visibilityPercent > 0) {
    const mainIssue = conversionPercent >= visibilityPercent ? 'conversion' : 'visibility';
    return {
      headline: 'Tes campagnes présentent des signaux mixtes.',
      explanation: mainIssue === 'conversion'
        ? 'Tu as à la fois des problèmes de visibilité et de conversion. Commence par la conversion : améliore ta fiche livre, puis augmente progressivement les enchères.'
        : 'Tu as à la fois des problèmes de visibilité et de conversion. Commence par la visibilité : augmente tes enchères pour collecter plus de données, puis optimise la conversion.',
      priorityFocus: mainIssue,
    };
  }

  return {
    headline: 'Tes campagnes sont en cours d\'analyse.',
    explanation: 'Pas encore assez de données pour identifier une tendance claire. Continue de laisser tourner.',
    priorityFocus: 'learning',
  };
}

// ══════════════════════════════════════════════════════════════
//  COMPOSANT PRINCIPAL
// ══════════════════════════════════════════════════════════════

export function BookBilan({ campaigns }: BookBilanProps) {
  const [showTechnicalDetail, setShowTechnicalDetail] = useState(false);

  const { categoryResults, totalEntities, narrative, expertSummary, allDiagnosisCounts } = useMemo(() => {
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

    // ── 5. Diagnostic expert global ──
    const visibilityCat = categoryResults.find(c => c.definition.key === 'visibility');
    const conversionCat = categoryResults.find(c => c.definition.key === 'conversion');
    const performingCat = categoryResults.find(c => c.definition.key === 'performing');
    const testingCat = categoryResults.find(c => c.definition.key === 'testing');

    const expertSummary = generateGlobalExpertSummary({
      visibilityPercent: visibilityCat?.pct ?? 0,
      conversionPercent: conversionCat?.pct ?? 0,
      performingPercent: performingCat?.pct ?? 0,
      testingPercent: testingCat?.pct ?? 0,
      diagnosticsCounts: {
        total,
        clicksNoSales: diagMap.get('clicks_no_sales') || 0,
        noImpressions: diagMap.get('no_impressions') || 0,
        winners: diagMap.get('winner') || 0,
        boostCandidates: diagMap.get('boost_candidate') || 0,
      },
    });

    return { categoryResults, totalEntities: total, narrative, expertSummary, allDiagnosisCounts };
  }, [campaigns]);

  if (totalEntities === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* ═══ 🧠 Diagnostic expert global ═══ */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧠</span>
            <h3 className="text-sm font-bold text-slate-900">Diagnostic global</h3>
          </div>
          <span className="text-xs text-slate-400">
            {totalEntities} ciblage{totalEntities > 1 ? 's' : ''} analysé{totalEntities > 1 ? 's' : ''}
          </span>
        </div>

        {/* Bloc expert coloré selon priorityFocus */}
        {expertSummary.priorityFocus === 'conversion' && (
          <div className="rounded-lg border-2 border-red-200 bg-red-50 px-4 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 border border-red-300">
                🎯 Priorité : Conversion
              </span>
            </div>
            <p className="text-sm font-semibold text-red-900 leading-snug">
              {expertSummary.headline}
            </p>
            <p className="text-[13px] text-red-800 mt-2 leading-relaxed">
              {expertSummary.explanation}
            </p>
          </div>
        )}
        {expertSummary.priorityFocus === 'visibility' && (
          <div className="rounded-lg border-2 border-amber-200 bg-amber-50 px-4 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300">
                👀 Priorité : Visibilité
              </span>
            </div>
            <p className="text-sm font-semibold text-amber-900 leading-snug">
              {expertSummary.headline}
            </p>
            <p className="text-[13px] text-amber-800 mt-2 leading-relaxed">
              {expertSummary.explanation}
            </p>
          </div>
        )}
        {expertSummary.priorityFocus === 'learning' && (
          <div className="rounded-lg border-2 border-blue-200 bg-blue-50 px-4 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 border border-blue-300">
                🧪 Phase : Apprentissage
              </span>
            </div>
            <p className="text-sm font-semibold text-blue-900 leading-snug">
              {expertSummary.headline}
            </p>
            <p className="text-[13px] text-blue-800 mt-2 leading-relaxed">
              {expertSummary.explanation}
            </p>
          </div>
        )}
      </div>

      {/* ═══ Détail technique (toujours visible) ═══ */}
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

      {/* ═══ Détail par catégorie (dépliable) ═══ */}
      <div className="border-t border-slate-100">
        <button
          onClick={() => setShowTechnicalDetail(prev => !prev)}
          className="w-full flex items-center justify-between px-5 py-2.5 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <span>Détail par catégorie</span>
          <svg
            className={`w-3.5 h-3.5 transition-transform ${showTechnicalDetail ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showTechnicalDetail && (
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
