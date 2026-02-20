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

export function RecommendationCard({
  recommendation: reco,
  onSimulate,
  onApply,
  onReject,
  safetyBlocked,
  safetyMessage,
}: RecommendationCardProps) {
  const [loading, setLoading] = useState<'simulate' | 'apply' | 'reject' | null>(null);
  const [expanded, setExpanded] = useState(false);

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

  const confidence = confidenceLabel(reco.confidence);

  // Mini-métriques à afficher (les plus pertinentes)
  const keyMetrics = ['spend', 'sales', 'clicks', 'orders']
    .map((k) => ({
      key: k,
      label: metricLabels[k],
      value: formatMetricValue(k, reco.metrics[k as keyof typeof reco.metrics]),
    }))
    .filter((m) => m.value !== null);

  return (
    <Card className="border-l-4 border-l-brand-500 hover:shadow-md transition-shadow">
      <CardContent>
        {/* ── Header : titre + campagne + confiance ── */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg flex-shrink-0">💡</span>
              <h4 className="text-base font-semibold text-slate-900 leading-tight">
                {reco.title}
              </h4>
            </div>
            {reco.entityName && (
              <p className="text-xs text-slate-400 ml-7 truncate">
                {reco.entityType === 'keyword' ? 'Mot-clé' : reco.entityType === 'search_term' ? 'Terme de recherche' : 'Campagne'} : {reco.entityName}
              </p>
            )}
          </div>
          {confidence && (
            <span className={`text-xs font-medium ${confidence.color} flex-shrink-0 mt-1`}>
              {confidence.text}
            </span>
          )}
        </div>

        {/* ── Pourquoi ce conseil ── */}
        <div className="mb-3 ml-7">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
            {t('recommendations.why')}
          </p>
          <p className="text-sm text-slate-700 leading-relaxed">{reco.why}</p>
        </div>

        {/* ── Mini métriques (chips) ── */}
        {keyMetrics.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3 ml-7">
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
              onClick={() => handleAction('apply', onApply)}
            >
              Appliquer
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
  );
}
