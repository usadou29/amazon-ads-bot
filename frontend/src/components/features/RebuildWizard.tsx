'use client';
import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import {
  getCreationPlan,
  getWorkspaceId,
  pauseAllForBook,
  pauseBatchCampaigns,
  createBatchFromPlan,
  type PauseAllForBookResult,
} from '@/lib/api/client';
import type {
  EvolutionViewModel,
  CreationPlan,
  CreationPlanResponse,
  StructuralGap,
  HarvestedAssets,
  CampaignToCreate,
} from '@/lib/transforms/campaign-evolution';

// ── Types ──────────────────────────────────────────────────────

type WizardStep = 'lifecycle' | 'strategy' | 'plan-review' | 'executing' | 'result';
type PauseOption = 'keep' | 'pause-all' | 'pause-selected';

interface RebuildWizardProps {
  bookId: string;
  initialAnalysis: EvolutionViewModel;
  lifecyclePhase: string;
  onClose: () => void;
  onSuccess: () => void;
}

// ── Constants ──────────────────────────────────────────────────

const LIFECYCLE_OPTIONS = [
  { value: 'launch', label: 'Lancement', desc: 'Nouveau livre, moins de 30 jours de pub' },
  { value: 'scale', label: 'Croissance', desc: 'En pleine montée, 1-6 mois de pub active' },
  { value: 'evergreen', label: 'Evergreen', desc: 'Livre mature, plus de 6 mois de pub stable' },
  { value: 'relaunch', label: 'Relance', desc: 'Nouveau souffle apres une pause ou refonte' },
];

// ── Component ──────────────────────────────────────────────────

export function RebuildWizard({ bookId, initialAnalysis, lifecyclePhase, onClose, onSuccess }: RebuildWizardProps) {
  const [step, setStep] = useState<WizardStep>('lifecycle');
  const [selectedLifecycle, setSelectedLifecycle] = useState(lifecyclePhase || initialAnalysis.lifecycleDetected?.phase || 'launch');
  const [pauseOption, setPauseOption] = useState<PauseOption>('keep');
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);

  // Plan data (fetched on-demand)
  const [planData, setPlanData] = useState<CreationPlanResponse | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  // Campaign overrides (budget, skip)
  const [campaignSkips, setCampaignSkips] = useState<Set<number>>(new Set());

  // Execution state
  const [executing, setExecuting] = useState(false);
  const [execPhase, setExecPhase] = useState<'pausing' | 'creating' | 'done'>('pausing');
  const [pauseResult, setPauseResult] = useState<PauseAllForBookResult | null>(null);
  const [createResult, setCreateResult] = useState<any>(null);
  const [execError, setExecError] = useState<string | null>(null);

  // ── Fetch creation plan ──────────────────────────────────

  const fetchPlan = useCallback(async (lifecycle: string) => {
    setPlanLoading(true);
    setPlanError(null);
    try {
      const data = await getCreationPlan({
        bookId,
        workspaceId: getWorkspaceId(),
        lifecyclePhaseOverride: lifecycle,
        forceRebuild: true,
      });
      setPlanData(data);
    } catch (err: any) {
      setPlanError(err?.response?.data?.message || err?.message || 'Erreur lors du calcul du plan');
    } finally {
      setPlanLoading(false);
    }
  }, [bookId]);

  // Fetch plan when lifecycle changes
  useEffect(() => {
    fetchPlan(selectedLifecycle);
  }, [selectedLifecycle, fetchPlan]);

  // ── Navigation ────────────────────────────────────────────

  const goNext = () => {
    switch (step) {
      case 'lifecycle': setStep('strategy'); break;
      case 'strategy': setStep('plan-review'); break;
      case 'plan-review': setStep('executing'); executeRebuild(); break;
    }
  };

  const goBack = () => {
    switch (step) {
      case 'strategy': setStep('lifecycle'); break;
      case 'plan-review': setStep('strategy'); break;
    }
  };

  // ── Execute Rebuild ───────────────────────────────────────

  const executeRebuild = async () => {
    setExecuting(true);
    setExecError(null);

    const workspaceId = getWorkspaceId();

    try {
      // Phase 1: Pause (if selected)
      if (pauseOption === 'pause-all') {
        setExecPhase('pausing');
        const result = await pauseAllForBook({
          workspaceId,
          bookId,
          reason: 'Rebuild propre — repartir sur des bases saines',
        });
        setPauseResult(result);
      } else if (pauseOption === 'pause-selected' && selectedCampaignIds.length > 0) {
        setExecPhase('pausing');
        const result = await pauseBatchCampaigns({
          workspaceId,
          bookId,
          campaignIds: selectedCampaignIds,
          reason: 'Rebuild propre — campagnes sélectionnées',
        });
        // Map to PauseAllForBookResult shape
        setPauseResult({
          totalActive: result.totalRequested,
          totalPaused: result.totalPaused,
          totalFailed: result.totalFailed,
          totalAlreadyPaused: 0,
          totalBudgetSaved: 0,
          failedCampaigns: result.results
            .filter((r: any) => !r.success)
            .map((r: any) => ({ campaignId: r.campaignId, name: r.campaignName, error: r.message })),
        });
      }

      // Phase 2: Create campaigns
      if (planData?.creationPlan) {
        setExecPhase('creating');
        const campaignsToSend = planData.creationPlan.campaignsToCreate
          .filter((_: any, i: number) => !campaignSkips.has(i));

        if (campaignsToSend.length > 0) {
          const batchResult = await createBatchFromPlan({
            workspaceId,
            bookId,
            planId: planData.creationPlan.planId,
            fingerprint: planData.creationPlan.fingerprint,
            lifecyclePhase: selectedLifecycle,
            campaigns: campaignsToSend,
          });
          setCreateResult(batchResult);
        }
      }

      setExecPhase('done');
      setStep('result');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Erreur inattendue';
      setExecError(msg);
      setStep('result');
    } finally {
      setExecuting(false);
    }
  };

  // ── Toggle campaign skip ─────────────────────────────────

  const toggleSkip = (index: number) => {
    setCampaignSkips(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // ── Toggle campaign for selective pause ───────────────────

  const toggleCampaignSelect = (campaignId: string) => {
    setSelectedCampaignIds(prev =>
      prev.includes(campaignId) ? prev.filter(id => id !== campaignId) : [...prev, campaignId],
    );
  };

  // ── Existing campaigns from analysis ─────────────────────

  const existingCampaigns = initialAnalysis.raw.campaignRoles || [];

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Creer des campagnes</h2>
            <p className="text-xs text-slate-500">
              {step === 'lifecycle' && 'Etape 1/4 — Phase de ton livre'}
              {step === 'strategy' && 'Etape 2/4 — Strategie de rebuild'}
              {step === 'plan-review' && 'Etape 3/4 — Plan propose'}
              {step === 'executing' && 'Execution en cours...'}
              {step === 'result' && 'Resultat'}
            </p>
          </div>
          {step !== 'executing' && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5 min-h-[300px]">
          {/* ── STEP 1: Lifecycle ── */}
          {step === 'lifecycle' && (
            <div>
              {initialAnalysis.lifecycleDetected && (
                <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <p className="text-sm font-medium text-blue-800">
                    Phase detectee : <strong>{initialAnalysis.lifecycleDetected.phase}</strong>
                    {' '}(confiance : {Math.round(initialAnalysis.lifecycleDetected.confidence * 100)}%)
                  </p>
                  {initialAnalysis.lifecycleDetected.reasonBullets.length > 0 && (
                    <ul className="mt-1 text-xs text-blue-700 space-y-0.5">
                      {initialAnalysis.lifecycleDetected.reasonBullets.slice(0, 3).map((b, i) => (
                        <li key={i}>— {b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <p className="text-sm text-slate-600 mb-3">
                On repart sur un setup propre pour ton livre. Confirme ou ajuste la phase :
              </p>

              <div className="space-y-2">
                {LIFECYCLE_OPTIONS.map(opt => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedLifecycle === opt.value
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="lifecycle"
                      value={opt.value}
                      checked={selectedLifecycle === opt.value}
                      onChange={() => setSelectedLifecycle(opt.value)}
                      className="accent-brand-600"
                    />
                    <div>
                      <span className="text-sm font-medium text-slate-900">{opt.label}</span>
                      <p className="text-xs text-slate-500">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── STEP 2: Strategy ── */}
          {step === 'strategy' && (
            <div>
              <p className="text-sm text-slate-600 mb-4">
                Que veux-tu faire de tes campagnes existantes ?
              </p>

              <div className="space-y-2 mb-4">
                <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${pauseOption === 'keep' ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="pauseOpt" checked={pauseOption === 'keep'} onChange={() => setPauseOption('keep')} className="mt-0.5 accent-brand-600" />
                  <div>
                    <span className="text-sm font-medium text-slate-900">Conserver mes campagnes existantes</span>
                    <p className="text-xs text-slate-500">Les nouvelles campagnes s'ajoutent a cote des existantes.</p>
                  </div>
                </label>

                <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${pauseOption === 'pause-all' ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="pauseOpt" checked={pauseOption === 'pause-all'} onChange={() => setPauseOption('pause-all')} className="mt-0.5 accent-brand-600" />
                  <div>
                    <span className="text-sm font-medium text-slate-900">Pauser TOUTES mes campagnes actives</span>
                    <p className="text-xs text-slate-500">On repart a zero avec une structure propre. Les campagnes sont pausees, pas supprimees.</p>
                  </div>
                </label>

                <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${pauseOption === 'pause-selected' ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="pauseOpt" checked={pauseOption === 'pause-selected'} onChange={() => setPauseOption('pause-selected')} className="mt-0.5 accent-brand-600" />
                  <div>
                    <span className="text-sm font-medium text-slate-900">Choisir lesquelles pauser</span>
                    <p className="text-xs text-slate-500">Selectionne manuellement les campagnes a mettre en pause.</p>
                  </div>
                </label>
              </div>

              {/* Campaign checklist for selective pause */}
              {pauseOption === 'pause-selected' && existingCampaigns.length > 0 && (
                <div className="border border-slate-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                  <p className="text-xs font-medium text-slate-500 mb-2">Selectionne les campagnes a pauser :</p>
                  {existingCampaigns.map(c => (
                    <label key={c.campaignId} className="flex items-center gap-2 py-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedCampaignIds.includes(c.campaignId)}
                        onChange={() => toggleCampaignSelect(c.campaignId)}
                        className="accent-brand-600"
                      />
                      <span className="text-sm text-slate-700">{c.campaignName}</span>
                      <span className="text-xs text-slate-400 ml-auto">{c.roles.join(', ')}</span>
                    </label>
                  ))}
                </div>
              )}

              {/* Gap summary */}
              {planData && planData.gaps.length > 0 && (
                <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <p className="text-xs font-semibold text-amber-800 mb-1">Pourquoi ce plan ?</p>
                  <ul className="text-xs text-amber-700 space-y-0.5">
                    {planData.gaps.slice(0, 3).map((g, i) => (
                      <li key={i}>— {g.label}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Plan Review ── */}
          {step === 'plan-review' && (
            <div>
              {planLoading && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <span className="animate-spin">⏳</span> Calcul du plan en cours...
                </div>
              )}

              {planError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                  {planError}
                </div>
              )}

              {planData && !planLoading && (
                <>
                  <p className="text-sm text-slate-600 mb-3">
                    Voici les campagnes qui vont etre creees (phase <strong>{planData.lifecycleUsed}</strong>) :
                  </p>

                  <div className="space-y-2 mb-4">
                    {planData.creationPlan.campaignsToCreate.map((c: CampaignToCreate, i: number) => {
                      const skipped = campaignSkips.has(i);
                      return (
                        <div
                          key={i}
                          className={`p-3 rounded-lg border ${skipped ? 'opacity-40 border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'}`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm font-medium text-slate-900">{c.name}</span>
                              <span className="text-xs text-slate-400 ml-2">{c.type} — {c.targetingMode}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500">{c.dailyBudget}€/j</span>
                              <button
                                onClick={() => toggleSkip(i)}
                                className={`text-xs px-2 py-0.5 rounded ${skipped ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'}`}
                              >
                                {skipped ? 'Reactiver' : 'Ignorer'}
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">{c.notesWhy}</p>
                          {c.seedKeywords && c.seedKeywords.length > 0 && !skipped && (
                            <p className="text-xs text-emerald-600 mt-1">
                              Seeds : {c.seedKeywords.slice(0, 5).join(', ')}{c.seedKeywords.length > 5 ? ` +${c.seedKeywords.length - 5}` : ''}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Budget total */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-sm font-medium text-slate-700">Budget total par jour</span>
                    <span className="text-sm font-bold text-slate-900">
                      {planData.creationPlan.campaignsToCreate
                        .filter((_: any, i: number) => !campaignSkips.has(i))
                        .reduce((sum: number, c: CampaignToCreate) => sum + c.dailyBudget, 0)
                        .toFixed(2)}€/j
                    </span>
                  </div>

                  {/* Harvested seeds */}
                  {planData.harvestedAssets && (planData.harvestedAssets.winnerKeywords.length > 0 || planData.harvestedAssets.winnerAsins.length > 0) && (
                    <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                      <p className="text-xs font-semibold text-emerald-800 mb-1">Seeds recuperees</p>
                      {planData.harvestedAssets.winnerKeywords.length > 0 && (
                        <p className="text-xs text-emerald-700">
                          {planData.harvestedAssets.winnerKeywords.length} mots-cles gagnants :
                          {' '}{planData.harvestedAssets.winnerKeywords.slice(0, 5).map(w => w.text).join(', ')}
                        </p>
                      )}
                      {planData.harvestedAssets.winnerAsins.length > 0 && (
                        <p className="text-xs text-emerald-700 mt-0.5">
                          {planData.harvestedAssets.winnerAsins.length} ASINs gagnants
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── STEP 4: Executing ── */}
          {step === 'executing' && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="animate-spin text-3xl mb-4">⏳</div>
              <p className="text-sm font-medium text-slate-700">
                {execPhase === 'pausing' && 'Mise en pause des campagnes...'}
                {execPhase === 'creating' && 'Creation des nouvelles campagnes...'}
                {execPhase === 'done' && 'Finalisation...'}
              </p>
              <p className="text-xs text-slate-400 mt-2">
                Ne ferme pas cette fenetre.
              </p>
            </div>
          )}

          {/* ── STEP 5: Result ── */}
          {step === 'result' && (
            <div>
              {execError && (
                <div className="p-4 rounded-lg bg-red-50 border border-red-200 mb-4">
                  <p className="text-sm font-medium text-red-800">Une erreur est survenue</p>
                  <p className="text-xs text-red-700 mt-1">{execError}</p>
                </div>
              )}

              {pauseResult && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 mb-3">
                  <p className="text-sm font-medium text-amber-800">Mise en pause</p>
                  <p className="text-xs text-amber-700">
                    {pauseResult.totalPaused} campagne{pauseResult.totalPaused > 1 ? 's' : ''} pausee{pauseResult.totalPaused > 1 ? 's' : ''}
                    {pauseResult.totalAlreadyPaused > 0 && `, ${pauseResult.totalAlreadyPaused} deja en pause`}
                    {pauseResult.totalFailed > 0 && (
                      <span className="text-red-600"> — {pauseResult.totalFailed} echec(s)</span>
                    )}
                  </p>
                  {pauseResult.totalBudgetSaved > 0 && (
                    <p className="text-xs text-amber-600 mt-0.5">
                      {pauseResult.totalBudgetSaved.toFixed(2)}€/j de budget economise
                    </p>
                  )}
                </div>
              )}

              {createResult && (
                <div className={`p-3 rounded-lg border mb-3 ${createResult.totalFailed > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                  <p className={`text-sm font-medium ${createResult.totalFailed > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                    Creation de campagnes
                  </p>
                  <p className={`text-xs ${createResult.totalFailed > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {createResult.totalCreated} creee{createResult.totalCreated > 1 ? 's' : ''}
                    {createResult.totalSkipped > 0 && `, ${createResult.totalSkipped} ignoree(s)`}
                    {createResult.totalFailed > 0 && `, ${createResult.totalFailed} echec(s)`}
                  </p>
                  {createResult.results && (
                    <div className="mt-2 space-y-1">
                      {createResult.results.map((r: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span>{r.success ? '✓' : '✗'}</span>
                          <span className="text-slate-700">{r.name}</span>
                          {!r.success && <span className="text-red-500">{r.message}</span>}
                          {r.alreadyCreated && <span className="text-slate-400">(deja creee)</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!execError && !createResult && !pauseResult && (
                <p className="text-sm text-slate-500">Aucune action executee.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200">
          <div>
            {(step === 'strategy' || step === 'plan-review') && (
              <Button variant="secondary" size="sm" onClick={goBack}>
                Precedent
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {step === 'result' ? (
              <>
                <Button variant="secondary" size="sm" onClick={onClose}>
                  Fermer
                </Button>
                <Button variant="primary" size="sm" onClick={onSuccess}>
                  Synchroniser et fermer
                </Button>
              </>
            ) : step === 'executing' ? null : (
              <>
                <Button variant="secondary" size="sm" onClick={onClose}>
                  Annuler
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={goNext}
                  disabled={planLoading || (step === 'plan-review' && !planData)}
                >
                  {step === 'plan-review' ? 'Lancer le rebuild' : 'Suivant'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
