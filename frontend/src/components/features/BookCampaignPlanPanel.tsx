'use client';
import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { analyzeCampaignEvolution, getWorkspaceId } from '@/lib/api/client';
import {
  mapCampaignEvolutionToViewModel,
  type EvolutionViewModel,
  type CampaignEvolutionResult,
  type TopAction,
} from '@/lib/transforms/campaign-evolution';
import { CreateCampaignWizard } from './CreateCampaignWizard';

// ── State Tag Styles ────────────────────────────────────────────

const stateTagConfig: Record<string, { label: string; bg: string; text: string; border: string; icon: string }> = {
  AUCUNE_CAMPAGNE: { label: 'Démarrage', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: '🚀' },
  CHAOS: { label: 'Restructuration', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: '🔧' },
  WINNERS: { label: 'Croissance', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: '📈' },
  STABLE: { label: 'Optimisation', bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: '⚙️' },
};

const priorityColors: Record<string, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
};

// ── Props ───────────────────────────────────────────────────────

interface BookCampaignPlanPanelProps {
  bookId: string;
  lifecyclePhase?: string;
  onCampaignCreated?: () => void;
}

// ── Component ───────────────────────────────────────────────────

export function BookCampaignPlanPanel({ bookId, lifecyclePhase, onCampaignCreated }: BookCampaignPlanPanelProps) {
  const [vm, setVm] = useState<EvolutionViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showRoadmap, setShowRoadmap] = useState(false);
  const [wizardAction, setWizardAction] = useState<TopAction | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    analyzeCampaignEvolution(bookId, getWorkspaceId())
      .then((result: CampaignEvolutionResult) => {
        if (!cancelled) {
          setVm(mapCampaignEvolutionToViewModel(result));
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.response?.data?.message || err?.message || 'Erreur lors de l\'analyse');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [bookId]);

  // ── Loading ───────────────────────────────────────
  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-5 bg-slate-200 rounded w-48" />
            <div className="h-4 bg-slate-100 rounded w-full" />
            <div className="h-4 bg-slate-100 rounded w-3/4" />
            <div className="flex gap-3 mt-4">
              <div className="h-20 bg-slate-100 rounded flex-1" />
              <div className="h-20 bg-slate-100 rounded flex-1" />
              <div className="h-20 bg-slate-100 rounded flex-1" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Error ─────────────────────────────────────────
  if (error) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-red-600">Impossible de charger le plan de croissance : {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!vm) return null;

  const tagCfg = stateTagConfig[vm.stateTag] || stateTagConfig.STABLE;

  return (
    <>
      <Card className="overflow-hidden">
        {/* ── Header ── */}
        <div className={`px-5 py-3 ${tagCfg.bg} border-b ${tagCfg.border}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">{tagCfg.icon}</span>
              <h3 className="text-sm font-semibold text-slate-900">Plan de croissance publicitaire</h3>
              <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${tagCfg.bg} ${tagCfg.text} ${tagCfg.border}`}>
                {tagCfg.label}
              </span>
            </div>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-slate-500 hover:text-slate-700 transition-colors"
            >
              {showDetails ? 'Masquer les détails' : 'Voir les détails'}
            </button>
          </div>
        </div>

        <CardContent className="pt-4">
          {/* ── 1. Summary sentence ── */}
          <p className="text-sm text-slate-700 leading-relaxed mb-4">
            {vm.summarySentence}
          </p>

          {/* ── 2. Top Actions ── */}
          {vm.topActions.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Actions recommandées
              </h4>
              <div className="space-y-2">
                {vm.topActions.map((action, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-slate-900">{action.title}</span>
                        {action.actionType === 'create_campaign' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                            Nouveau
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2">{action.why || action.description}</p>
                    </div>
                    {action.isExecutable ? (
                      <Button
                        size="sm"
                        variant={action.actionType === 'create_campaign' ? 'primary' : 'secondary'}
                        onClick={() => setWizardAction(action)}
                      >
                        {action.ctaLabel}
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400 px-2 py-1">{action.ctaLabel}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 3. Roadmap Toggle ── */}
          {vm.roadmap.length > 0 && (
            <div>
              <button
                onClick={() => setShowRoadmap(!showRoadmap)}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hover:text-brand-600 transition-colors mb-2"
              >
                <span>{showRoadmap ? '▼' : '▶'}</span>
                Plan 30 jours
              </button>
              {showRoadmap && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {vm.roadmap.map((week, i) => (
                    <div key={i} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                      <h5 className="text-xs font-semibold text-slate-700 mb-2">{week.weekLabel}</h5>
                      <div className="space-y-1.5">
                        {week.items.map((item, j) => (
                          <div key={j} className="flex items-start gap-1.5">
                            <span className={`inline-block mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              item.priority === 'high' ? 'bg-red-400' : item.priority === 'medium' ? 'bg-amber-400' : 'bg-slate-300'
                            }`} />
                            <div>
                              <p className="text-xs font-medium text-slate-700">{item.title}</p>
                              {item.desc && <p className="text-[11px] text-slate-500">{item.desc}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── 4. Details (hidden by default) ── */}
          {showDetails && (
            <div className="mt-4 pt-3 border-t border-slate-100">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-2 rounded-lg bg-slate-50">
                  <p className="text-lg font-bold text-slate-900">{vm.details.maturityScore}</p>
                  <p className="text-[11px] text-slate-500">Maturité</p>
                </div>
                <div className="p-2 rounded-lg bg-slate-50">
                  <p className="text-lg font-bold text-slate-900">{(vm.details.chaosScore * 100).toFixed(0)}%</p>
                  <p className="text-[11px] text-slate-500">Chaos</p>
                </div>
                <div className="p-2 rounded-lg bg-slate-50">
                  <p className="text-lg font-bold text-slate-900">{(vm.details.duplicationScore * 100).toFixed(0)}%</p>
                  <p className="text-[11px] text-slate-500">Duplication</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {(['structure', 'winnersExploited', 'diversification', 'stability'] as const).map((key) => {
                  const max = key === 'structure' || key === 'winnersExploited' ? 30 : 20;
                  const val = vm.details.maturityBreakdown[key];
                  const pct = Math.min((val / max) * 100, 100);
                  const labels: Record<string, string> = { structure: 'Structure', winnersExploited: 'Winners', diversification: 'Diversif.', stability: 'Stabilité' };
                  return (
                    <div key={key} className="text-center">
                      <p className="text-[11px] text-slate-500 mb-1">{labels[key]}</p>
                      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{val}/{max}</p>
                    </div>
                  );
                })}
              </div>
              {/* Context stats */}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                <span>{vm.context.totalCampaigns} campagnes</span>
                <span>{vm.context.totalKeywords} mots-clés</span>
                <span>{vm.context.totalProductTargets} targets</span>
                <span>{vm.context.totalWinnerKeywords} winners</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Wizard Modal ── */}
      {wizardAction && (
        <CreateCampaignWizard
          bookId={bookId}
          action={wizardAction}
          lifecyclePhase={lifecyclePhase}
          onClose={() => setWizardAction(null)}
          onCreated={() => {
            setWizardAction(null);
            onCampaignCreated?.();
          }}
        />
      )}
    </>
  );
}
