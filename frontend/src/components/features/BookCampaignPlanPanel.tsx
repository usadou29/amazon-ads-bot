'use client';
import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { analyzeCampaignEvolution, getWorkspaceId } from '@/lib/api/client';
import {
  mapCampaignEvolutionToViewModel,
  type EvolutionViewModel,
  type CampaignEvolutionResult,
  type StructuralGap,
} from '@/lib/transforms/campaign-evolution';
import { CreateCampaignWizard } from './CreateCampaignWizard';
import { RebuildWizard } from './RebuildWizard';

// ── State Tag Styles ────────────────────────────────────────────

const stateTagConfig: Record<string, { label: string; bg: string; text: string; border: string; icon: string }> = {
  AUCUNE_CAMPAGNE: { label: 'Démarrage', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: '🚀' },
  CHAOS: { label: 'Restructuration', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: '🔧' },
  WINNERS: { label: 'Croissance', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: '📈' },
  STABLE: { label: 'Optimisation', bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: '⚙️' },
};

const gapSeverityStyles: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  high: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  medium: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  low: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
};

const themeColors: Record<string, { bg: string; border: string; text: string }> = {
  VISIBILITE: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800' },
  CONVERSION: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800' },
  RENTABILITE: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800' },
  STRUCTURE: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800' },
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
  const [showRoadmap, setShowRoadmap] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showRebuildWizard, setShowRebuildWizard] = useState(false);

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
            <div className="h-10 bg-slate-100 rounded w-40 mt-4" />
          </div>
        </CardContent>
      </Card>
    );
  }

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
  const focus = vm.topFocus;
  const focusTheme = themeColors[focus.theme] || themeColors.VISIBILITE;
  const cta = focus.primaryCta;
  const showCreateButton = cta.intent === 'CREATE' && vm.creationPlan;
  const showAlwaysCreateButton = !showCreateButton;

  return (
    <>
      <Card className="overflow-hidden">
        {/* ── Header Bar ── */}
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
          {/* ── A) Coach Summary (1–2 phrases) ── */}
          <div className="mb-4">
            <h4 className="text-base font-semibold text-slate-900 mb-1">{focus.title}</h4>
            <p className="text-sm text-slate-600 leading-relaxed">{focus.summary}</p>
          </div>

          {/* ── B) Top Focus: Evidence (2 max) ── */}
          {focus.evidence.length > 0 && (
            <div className="flex gap-3 mb-4">
              {focus.evidence.map((ev, i) => (
                <div
                  key={i}
                  className={`flex-1 p-3 rounded-lg border ${focusTheme.bg} ${focusTheme.border}`}
                >
                  <p className={`text-xs font-medium ${focusTheme.text} opacity-70`}>{ev.label}</p>
                  <p className={`text-sm font-semibold ${focusTheme.text}`}>{ev.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* ── B.2) Gap Badges ── */}
          {vm.gaps.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {vm.gaps.map((gap, i) => {
                const style = gapSeverityStyles[gap.severity] || gapSeverityStyles.medium;
                return (
                  <span
                    key={i}
                    className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full border ${style.bg} ${style.text} ${style.border}`}
                    title={gap.explanation}
                  >
                    {gap.severity === 'critical' && '●  '}
                    {gap.severity === 'high' && '◐  '}
                    {gap.label}
                  </span>
                );
              })}
            </div>
          )}

          {/* ── C) Primary CTA (1 button max) + Always-visible secondary ── */}
          <div className="mb-4 flex items-center gap-2">
            {showCreateButton ? (
              <Button
                variant="primary"
                onClick={() => setShowWizard(true)}
              >
                {cta.label}
              </Button>
            ) : cta.intent === 'CLEANUP' ? (
              <Button variant="secondary" onClick={() => setShowRoadmap(true)}>
                {cta.label}
              </Button>
            ) : cta.intent === 'AMPLIFY' ? (
              <Button variant="secondary" onClick={() => setShowRoadmap(true)}>
                {cta.label}
              </Button>
            ) : (
              <span className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-lg">
                {cta.label}
              </span>
            )}
            {showAlwaysCreateButton && (
              <Button variant="secondary" size="sm" onClick={() => setShowRebuildWizard(true)}>
                Creer des campagnes
              </Button>
            )}
          </div>

          {/* ── Top Actions (secondary) ── */}
          {vm.topActions.length > 0 && !showCreateButton && (
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
                      <span className="text-sm font-medium text-slate-900">{action.title}</span>
                      <p className="text-xs text-slate-500 mt-0.5">{action.why || action.description}</p>
                    </div>
                    {action.isExecutable && (
                      <Button size="sm" variant="secondary" onClick={() => setShowWizard(true)}>
                        {action.ctaLabel}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Roadmap Toggle ── */}
          {vm.roadmap.length > 0 && (
            <div>
              <button
                onClick={() => setShowRoadmap(!showRoadmap)}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hover:text-brand-600 transition-colors mb-2"
              >
                <span>{showRoadmap ? '▼' : '▶'}</span>
                Voir le plan 30 jours
              </button>
              {showRoadmap && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {vm.roadmap.map((week, i) => (
                    <div key={i} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                      <h5 className="text-xs font-semibold text-slate-700 mb-0.5">{week.weekLabel}</h5>
                      <p className="text-[11px] text-slate-500 mb-2 italic">{week.weekTitle}</p>
                      <div className="space-y-2">
                        {week.items.map((item, j) => (
                          <div key={j} className="flex items-start gap-1.5">
                            <span className={`inline-block mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              item.priority === 'high' ? 'bg-red-400' : item.priority === 'medium' ? 'bg-amber-400' : 'bg-slate-300'
                            }`} />
                            <div>
                              <p className="text-xs font-medium text-slate-700">{item.title}</p>
                              {item.why && <p className="text-[11px] text-slate-500 mt-0.5">{item.why}</p>}
                              {item.impact && <p className="text-[11px] text-emerald-600 mt-0.5">{item.impact}</p>}
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

          {/* ── Details (hidden by default) ── */}
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
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                <span>{vm.context.totalCampaigns} campagnes</span>
                <span>{vm.context.totalKeywords} mots-clés</span>
                <span>{vm.context.totalProductTargets} targets</span>
                <span>{vm.context.totalWinnerKeywords} winners</span>
                {vm.context.avgAcos ? <span>ACoS moy. {vm.context.avgAcos}%</span> : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Wizard Modal ── */}
      {showWizard && (
        <CreateCampaignWizard
          bookId={bookId}
          creationPlan={vm.creationPlan}
          topActions={vm.topActions}
          lifecyclePhase={lifecyclePhase}
          onClose={() => setShowWizard(false)}
          onCreated={() => {
            setShowWizard(false);
            onCampaignCreated?.();
          }}
        />
      )}

      {/* ── Rebuild Wizard Modal ── */}
      {showRebuildWizard && (
        <RebuildWizard
          bookId={bookId}
          initialAnalysis={vm}
          lifecyclePhase={lifecyclePhase || vm.context.lifecyclePhase}
          onClose={() => setShowRebuildWizard(false)}
          onSuccess={() => {
            setShowRebuildWizard(false);
            onCampaignCreated?.();
          }}
        />
      )}
    </>
  );
}
