'use client';
import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { t } from '@/lib/i18n';
import { HumanRecommendation } from '@/lib/transforms/recommendations';

interface RecommendationCardProps {
  recommendation: HumanRecommendation;
  onSimulate: (id: string) => Promise<void>;
  onApply: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  safetyBlocked: boolean;
  safetyMessage?: string;
  /** If true, this card is shown as an alternative (compact mode) */
  isAlternative?: boolean;
}

const riskColors: Record<string, string> = {
  low: 'text-emerald-600',
  medium: 'text-amber-600',
  high: 'text-red-600',
};

const riskDots: Record<string, string> = {
  low: 'bg-emerald-500',
  medium: 'bg-amber-500',
  high: 'bg-red-500',
};

const riskLabels: Record<string, string> = {
  low: 'Faible',
  medium: 'Modéré',
  high: 'Élevé',
};

const confidenceLabel = (score: number | null): { text: string; color: string } | null => {
  if (score === null) return null;
  if (score >= 80) return { text: 'Très fiable', color: 'text-emerald-600' };
  if (score >= 60) return { text: 'Fiable', color: 'text-blue-600' };
  if (score >= 40) return { text: 'Modérée', color: 'text-amber-600' };
  return { text: 'Exploratoire', color: 'text-slate-500' };
};

function formatMetricValue(key: string, value: number | undefined): string | null {
  if (value === undefined || value === null) return null;
  switch (key) {
    case 'spend':
    case 'sales':
      return `${value.toFixed(2)} €`;
    case 'acos':
    case 'ctr':
    case 'cvr':
      return `${value.toFixed(1)}%`;
    case 'clicks':
    case 'impressions':
    case 'orders':
      return String(Math.round(value));
    default:
      return String(value);
  }
}

const metricLabels: Record<string, string> = {
  spend: 'Dépensé',
  sales: 'Ventes',
  acos: 'ACoS',
  clicks: 'Clics',
  orders: 'Commandes',
  impressions: 'Impressions',
  ctr: 'Taux de clic',
  cvr: 'Taux de conversion',
};

// ── Strategy badge colors ──
function getStrategyBadge(reco: HumanRecommendation): {
  bg: string;
  text: string;
  label: string;
  icon: string;
} | null {
  if (!reco.strategyLabel) return null;

  if (reco.recommendedForLifecycle) {
    return {
      bg: 'bg-emerald-100',
      text: 'text-emerald-700',
      label: reco.strategyLabel,
      icon: '✅',
    };
  }

  const score = reco.strategyScore ?? 0;
  if (score >= 50) {
    return {
      bg: 'bg-blue-50',
      text: 'text-blue-600',
      label: reco.strategyLabel,
      icon: '🔄',
    };
  }

  return {
    bg: 'bg-slate-100',
    text: 'text-slate-500',
    label: reco.strategyLabel,
    icon: '⚠️',
  };
}

// ── Consent Modal Component ──
function ConsentModal({
  reco,
  onConfirm,
  onCancel,
  loading,
}: {
  reco: HumanRecommendation;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const isReinforced = reco.consentLevel === 'reinforced';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">{isReinforced ? '⚠️' : '📘'}</span>
          <h3 className="text-lg font-semibold text-slate-900">
            {isReinforced ? 'Confirmation requise' : 'Avant d\'appliquer...'}
          </h3>
        </div>

        <div className={`p-4 rounded-lg mb-4 ${
          isReinforced ? 'bg-amber-50 border border-amber-200' : 'bg-blue-50 border border-blue-100'
        }`}>
          <p className={`text-sm leading-relaxed ${
            isReinforced ? 'text-amber-800' : 'text-blue-800'
          }`}>
            {reco.consentMessage || 'Cette action nécessite ta confirmation.'}
          </p>
        </div>

        <p className="text-sm text-slate-600 mb-6">
          <span className="font-medium">Action :</span> {reco.action.description}
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
              isReinforced
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-brand-600 hover:bg-brand-700'
            }`}
          >
            {loading ? 'Application...' : isReinforced ? 'Je confirme' : 'Appliquer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RecommendationCard({
  recommendation: reco,
  onSimulate,
  onApply,
  onReject,
  safetyBlocked,
  safetyMessage,
  isAlternative = false,
}: RecommendationCardProps) {
  const [loading, setLoading] = useState<'simulate' | 'apply' | 'reject' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showConsent, setShowConsent] = useState(false);

  const handleAction = async (
    action: 'simulate' | 'apply' | 'reject',
    fn: (id: string) => Promise<void>,
  ) => {
    setLoading(action);
    try {
      await fn(reco.id);
    } finally {
      setLoading(null);
    }
  };

  const handleApplyClick = () => {
    if (reco.requiresConsent) {
      setShowConsent(true);
    } else {
      handleAction('apply', onApply);
    }
  };

  const handleConsentConfirm = () => {
    setShowConsent(false);
    handleAction('apply', onApply);
  };

  const confidence = confidenceLabel(reco.confidence);
  const strategyBadge = getStrategyBadge(reco);

  // Mini-métriques à afficher (les plus pertinentes)
  const keyMetrics = ['spend', 'sales', 'clicks', 'orders']
    .map((k) => ({
      key: k,
      label: metricLabels[k],
      value: formatMetricValue(k, reco.metrics[k as keyof typeof reco.metrics]),
    }))
    .filter((m) => m.value !== null);

  // Score bar width
  const scoreWidth = reco.strategyScore != null ? `${Math.min(reco.strategyScore, 100)}%` : '0%';
  const scoreColor = (reco.strategyScore ?? 0) >= 70
    ? 'bg-emerald-500'
    : (reco.strategyScore ?? 0) >= 50
      ? 'bg-amber-400'
      : 'bg-red-400';

  // Border color depends on recommended status
  const borderColor = reco.recommendedForLifecycle
    ? 'border-l-emerald-500'
    : isAlternative
      ? 'border-l-slate-300'
      : 'border-l-brand-500';

  return (
    <>
      <Card className={`border-l-4 ${borderColor} hover:shadow-md transition-shadow ${
        isAlternative ? 'bg-slate-50/50' : ''
      }`}>
        <CardContent>
          {/* ── Header : titre + campagne + strategy badge + confiance ── */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-lg flex-shrink-0">
                  {reco.recommendedForLifecycle ? '✅' : '💡'}
                </span>
                <h4 className="text-base font-semibold text-slate-900 leading-tight">
                  {reco.title}
                </h4>
              </div>
              {reco.entityName && (
                <div className="ml-7">
                  <p className="text-xs text-slate-400 truncate">
                    {reco.entityType === 'keyword' ? 'Mot-clé' : reco.entityType === 'search_term' ? 'Terme de recherche' : 'Campagne'} : {reco.entityName}
                  </p>
                  {reco.campaignName && (
                    <p className="text-xs text-slate-300 truncate">
                      Campagne : {reco.campaignName}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              {strategyBadge && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${strategyBadge.bg} ${strategyBadge.text}`}>
                  {strategyBadge.icon} {strategyBadge.label}
                </span>
              )}
              {confidence && (
                <span className={`text-xs font-medium ${confidence.color}`}>
                  {confidence.text}
                </span>
              )}
            </div>
          </div>

          {/* ── Score bar (mini) ── */}
          {reco.strategyScore != null && (
            <div className="mb-3 ml-7">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${scoreColor}`}
                    style={{ width: scoreWidth }}
                  />
                </div>
                <span className="text-xs text-slate-400 w-8 text-right">{reco.strategyScore}</span>
              </div>
            </div>
          )}

          {/* ── Pourquoi ce conseil ── */}
          <div className="mb-3 ml-7">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
              {t('recommendations.why')}
            </p>
            <p className="text-sm text-slate-700 leading-relaxed">{reco.why}</p>
          </div>

          {/* ── Mini métriques (chips) + période ── */}
          {keyMetrics.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3 ml-7">
              <span className="text-xs text-slate-300 italic">
                {reco.metricsPeriodDays}j
              </span>
              {keyMetrics.map((m) => (
                <span
                  key={m.key}
                  className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full"
                >
                  <span className="text-slate-400">{m.label}</span>
                  <span className="font-medium">{m.value}</span>
                </span>
              ))}
            </div>
          )}

          {/* ── Impact + Risque ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 ml-7">
            <div className="bg-emerald-50 rounded-lg p-3">
              <p className="text-xs font-medium text-emerald-600 mb-1">
                {t('recommendations.impact')}
              </p>
              <p className="text-sm text-emerald-800">{reco.impact}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs font-medium text-slate-500 mb-1">
                Risque ({riskLabels[reco.riskLevel]})
              </p>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${riskDots[reco.riskLevel]}`} />
                <p className={`text-sm ${riskColors[reco.riskLevel]}`}>{reco.risk}</p>
              </div>
            </div>
          </div>

          {/* ── Action suggérée ── */}
          <div className="mb-4 ml-7 p-2.5 bg-brand-50 border border-brand-100 rounded-lg">
            <p className="text-xs text-brand-700">
              <span className="font-semibold">Action :</span> {reco.action.description}
            </p>
          </div>

          {/* ── Conseil pour le livre (optionnel) ── */}
          {reco.bookAdvice && (
            <div className="mb-4 ml-7 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs font-medium text-amber-700 mb-1">
                Conseil pour ton livre
              </p>
              <p className="text-sm text-amber-800 leading-relaxed">{reco.bookAdvice}</p>
            </div>
          )}

          {/* ── Consent warning (inline hint) ── */}
          {reco.requiresConsent && (
            <div className="mb-4 ml-7 p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-xs text-blue-700">
                <span className="font-semibold">📘 Information :</span>{' '}
                {reco.consentLevel === 'reinforced'
                  ? 'Une confirmation renforcée te sera demandée avant application.'
                  : 'Un rappel pédagogique te sera présenté avant application.'
                }
              </p>
            </div>
          )}

          {/* ── Détails avancés (collapsible) ── */}
          {reco.metrics.acos !== undefined && (
            <div className="ml-7 mb-3">
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                {expanded ? '▾ Masquer les détails' : '▸ Voir les détails'}
              </button>
              {expanded && (
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(reco.metrics)
                    .filter(([, v]) => v !== undefined)
                    .map(([key, value]) => (
                      <div key={key} className="text-center p-2 bg-slate-50 rounded">
                        <p className="text-xs text-slate-400">{metricLabels[key] || key}</p>
                        <p className="text-sm font-medium text-slate-700">
                          {formatMetricValue(key, value)}
                        </p>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* ── Boutons d'action ── */}
          <div className="flex flex-wrap gap-2 ml-7">
            <Button
              variant="secondary"
              size="sm"
              loading={loading === 'simulate'}
              onClick={() => handleAction('simulate', onSimulate)}
            >
              Simuler
            </Button>

            <div className="relative group">
              <Button
                variant="primary"
                size="sm"
                disabled={safetyBlocked}
                loading={loading === 'apply'}
                onClick={handleApplyClick}
              >
                {reco.recommendedForLifecycle ? '✅ Appliquer' : 'Appliquer'}
              </Button>
              {safetyBlocked && safetyMessage && (
                <div className="absolute bottom-full left-0 mb-2 px-3 py-1.5 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                  {safetyMessage}
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              loading={loading === 'reject'}
              onClick={() => handleAction('reject', onReject)}
            >
              Ignorer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Consent Modal ── */}
      {showConsent && (
        <ConsentModal
          reco={reco}
          onConfirm={handleConsentConfirm}
          onCancel={() => setShowConsent(false)}
          loading={loading === 'apply'}
        />
      )}
    </>
  );
}
