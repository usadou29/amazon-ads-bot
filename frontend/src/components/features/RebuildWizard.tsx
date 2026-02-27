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
  type CreationMode,
} from '@/lib/api/client';
import type {
  EvolutionViewModel,
  CreationPlan,
  CreationPlanResponse,
  StructuralGap,
  HarvestedAssets,
  CampaignToCreate,
  CampaignExplanation,
} from '@/lib/transforms/campaign-evolution';

// ── Types ──────────────────────────────────────────────────────

type WizardStep = 'lifecycle' | 'mode-choice' | 'strategy' | 'plan-review' | 'recap' | 'executing' | 'result';
type PauseOption = 'keep' | 'pause-all' | 'pause-selected';

interface RebuildWizardProps {
  bookId: string;
  initialAnalysis: EvolutionViewModel;
  lifecyclePhase: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface CampaignOverrides {
  dailyBudget: number;
  defaultBid: number;
  topOfSearchBoost: number;
  enabled: boolean;
}

// ── Constants ──────────────────────────────────────────────────

const LIFECYCLE_OPTIONS = [
  { value: 'launch', label: 'Lancement', desc: 'Nouveau livre, moins de 30 jours de pub' },
  { value: 'scale', label: 'Croissance', desc: 'En pleine montee, 1-6 mois de pub active' },
  { value: 'evergreen', label: 'Evergreen', desc: 'Livre mature, plus de 6 mois de pub stable' },
  { value: 'relaunch', label: 'Relance', desc: 'Nouveau souffle apres une pause ou refonte' },
];

const TYPE_LABELS: Record<string, string> = {
  SP_AUTO: 'SP Auto',
  SP_MANUAL_BROAD: 'SP Expression',
  SP_MANUAL_PHRASE: 'SP Phrase',
  SP_MANUAL_EXACT: 'SP Exact',
  SP_PRODUCT: 'SP Produit',
  SP_CATEGORY: 'SP Categorie',
  SB_VIDEO: 'SB Video',
};

const STRATEGY_LABELS: Record<string, string> = {
  UP_DOWN: 'Up & Down',
  DOWN_ONLY: 'Down Only',
  FIXED: 'Fixe',
};

const DATASOURCE_BADGES: Record<string, { label: string; bg: string; text: string }> = {
  real_data: { label: 'Donnees reelles', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  lifecycle_default: { label: 'Defaut lifecycle', bg: 'bg-blue-100', text: 'text-blue-700' },
  inferred: { label: 'Infere', bg: 'bg-amber-100', text: 'text-amber-700' },
  rule_based: { label: 'Regle', bg: 'bg-slate-100', text: 'text-slate-600' },
};

// ── Component ──────────────────────────────────────────────────

export function RebuildWizard({ bookId, initialAnalysis, lifecyclePhase, onClose, onSuccess }: RebuildWizardProps) {
  const [step, setStep] = useState<WizardStep>('lifecycle');
  const [selectedLifecycle, setSelectedLifecycle] = useState(lifecyclePhase || initialAnalysis.lifecycleDetected?.phase || 'launch');
  const [selectedMode, setSelectedMode] = useState<CreationMode | null>(null);
  const [pauseOption, setPauseOption] = useState<PauseOption>('keep');
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expandedExplanation, setExpandedExplanation] = useState<number | null>(null);

  // Plan data
  const [planData, setPlanData] = useState<CreationPlanResponse | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  // Campaign overrides
  const [overrides, setOverrides] = useState<Map<number, CampaignOverrides>>(new Map());

  // Execution state
  const [executing, setExecuting] = useState(false);
  const [execPhase, setExecPhase] = useState<'pausing' | 'creating' | 'done'>('pausing');
  const [pauseResult, setPauseResult] = useState<PauseAllForBookResult | null>(null);
  const [createResult, setCreateResult] = useState<any>(null);
  const [execError, setExecError] = useState<string | null>(null);

  // ── Derive harvest data availability (to show recommendations) ──

  const hasExistingCampaigns = (initialAnalysis.raw?.campaignRoles?.length ?? 0) > 0;
  const hasWinners = (initialAnalysis.context?.totalWinnerKeywords ?? 0) > 0;

  // ── Fetch creation plan ──────────────────────────────────

  const fetchPlan = useCallback(async (lifecycle: string, mode: CreationMode) => {
    setPlanLoading(true);
    setPlanError(null);
    try {
      const data = await getCreationPlan({
        bookId,
        workspaceId: getWorkspaceId(),
        lifecyclePhaseOverride: lifecycle,
        forceRebuild: true,
        mode,
      });
      setPlanData(data);
      // Initialize overrides from plan
      const newOverrides = new Map<number, CampaignOverrides>();
      data.creationPlan.campaignsToCreate.forEach((c: CampaignToCreate, i: number) => {
        newOverrides.set(i, {
          dailyBudget: c.dailyBudget,
          defaultBid: c.defaultBid,
          topOfSearchBoost: c.placementAdjustments?.topOfSearch || 0,
          enabled: true,
        });
      });
      setOverrides(newOverrides);
    } catch (err: any) {
      setPlanError(err?.response?.data?.message || err?.message || 'Erreur lors du calcul du plan');
    } finally {
      setPlanLoading(false);
    }
  }, [bookId]);

  // Fetch plan when entering plan-review (after mode is chosen)
  useEffect(() => {
    if (step === 'plan-review' && selectedMode) {
      fetchPlan(selectedLifecycle, selectedMode);
    }
  }, [step, selectedLifecycle, selectedMode, fetchPlan]);

  // ── Helpers ─────────────────────────────────────────────────

  const getOverride = (i: number): CampaignOverrides => {
    return overrides.get(i) || { dailyBudget: 0, defaultBid: 0, topOfSearchBoost: 0, enabled: true };
  };

  const updateOverride = (i: number, partial: Partial<CampaignOverrides>) => {
    setOverrides(prev => {
      const next = new Map(prev);
      const current = next.get(i) || { dailyBudget: 0, defaultBid: 0, topOfSearchBoost: 0, enabled: true };
      next.set(i, { ...current, ...partial });
      return next;
    });
  };

  const enabledCampaigns = planData?.creationPlan.campaignsToCreate
    .map((c: CampaignToCreate, i: number) => ({ campaign: c, index: i }))
    .filter(({ index }) => getOverride(index).enabled) || [];

  const totalDailyBudget = enabledCampaigns.reduce(
    (sum, { index }) => sum + getOverride(index).dailyBudget, 0
  );

  // ── Navigation ─────────────────────────────────────────────

  const goNext = () => {
    switch (step) {
      case 'lifecycle': setStep('mode-choice'); break;
      case 'mode-choice': setStep('strategy'); break;
      case 'strategy': setStep('plan-review'); break;
      case 'plan-review': setStep('recap'); break;
      case 'recap': setStep('executing'); executeRebuild(); break;
    }
  };

  const goBack = () => {
    switch (step) {
      case 'mode-choice': setStep('lifecycle'); break;
      case 'strategy': setStep('mode-choice'); break;
      case 'plan-review': setStep('strategy'); break;
      case 'recap': setStep('plan-review'); break;
    }
  };

  const canGoNext = (): boolean => {
    switch (step) {
      case 'lifecycle': return true;
      case 'mode-choice': return selectedMode !== null;
      case 'strategy': return true;
      case 'plan-review': return !planLoading && !!planData;
      case 'recap': return !!planData;
      default: return false;
    }
  };

  const stepNumber = (): string => {
    switch (step) {
      case 'lifecycle': return 'Etape 1/6 — Phase de ton livre';
      case 'mode-choice': return 'Etape 2/6 — Choix strategique';
      case 'strategy': return 'Etape 3/6 — Campagnes existantes';
      case 'plan-review': return 'Etape 4/6 — Plan strategique';
      case 'recap': return 'Etape 5/6 — Recapitulatif detaille';
      case 'executing': return 'Execution en cours...';
      case 'result': return 'Resultat';
      default: return '';
    }
  };

  // ── Execute Rebuild ────────────────────────────────────────

  const executeRebuild = async () => {
    setExecuting(true);
    setExecError(null);

    const workspaceId = getWorkspaceId();

    try {
      // Phase 1: Pause
      if (pauseOption === 'pause-all') {
        setExecPhase('pausing');
        const result = await pauseAllForBook({
          workspaceId,
          bookId,
          reason: `Rebuild propre (mode ${selectedMode}) — repartir sur des bases saines`,
        });
        setPauseResult(result);
      } else if (pauseOption === 'pause-selected' && selectedCampaignIds.length > 0) {
        setExecPhase('pausing');
        const result = await pauseBatchCampaigns({
          workspaceId,
          bookId,
          campaignIds: selectedCampaignIds,
          reason: `Rebuild propre (mode ${selectedMode}) — campagnes selectionnees`,
        });
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

      // Phase 2: Create campaigns with overrides applied
      if (planData?.creationPlan) {
        setExecPhase('creating');
        const campaignsToSend = planData.creationPlan.campaignsToCreate
          .map((c: CampaignToCreate, i: number) => {
            const ov = getOverride(i);
            if (!ov.enabled) return null;
            return {
              ...c,
              dailyBudget: ov.dailyBudget,
              defaultBid: ov.defaultBid,
              placementAdjustments: ov.topOfSearchBoost > 0
                ? { topOfSearch: ov.topOfSearchBoost, restOfSearch: 0, productPages: 0 }
                : c.placementAdjustments,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

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

  // ── Toggle helpers ─────────────────────────────────────────

  const toggleCampaignSelect = (campaignId: string) => {
    setSelectedCampaignIds(prev =>
      prev.includes(campaignId) ? prev.filter(id => id !== campaignId) : [...prev, campaignId],
    );
  };

  const existingCampaigns = initialAnalysis.raw.campaignRoles || [];

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Campaign Setup Builder</h2>
            <p className="text-xs text-slate-500">{stepNumber()}</p>
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
                        <li key={i}>- {b}</li>
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

          {/* ── STEP 2: Mode Choice (HARVEST / RESET) ── */}
          {step === 'mode-choice' && (
            <div>
              <p className="text-sm text-slate-600 mb-4">
                Choisis ta strategie de creation de campagnes :
              </p>

              <div className="space-y-3">
                {/* HARVEST option */}
                <label
                  className={`block p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedMode === 'HARVEST'
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="creationMode"
                      checked={selectedMode === 'HARVEST'}
                      onChange={() => setSelectedMode('HARVEST')}
                      className="mt-0.5 accent-emerald-600"
                    />
                    <div>
                      <span className="text-sm font-semibold text-slate-900">HARVEST — Optimiser l'existant</span>
                      <p className="text-xs text-slate-500 mt-1">
                        Recupere tes mots-cles gagnants, ASINs performants et negatifs de tes campagnes existantes.
                        Construit de nouvelles campagnes pre-chargees avec tes donnees reelles.
                      </p>
                      {hasWinners && (
                        <p className="text-xs text-emerald-600 mt-1.5 font-medium">
                          {initialAnalysis.context?.totalWinnerKeywords || 0} mots-cles gagnants detectes — recommande pour ton profil
                        </p>
                      )}
                      {!hasWinners && hasExistingCampaigns && (
                        <p className="text-xs text-amber-600 mt-1.5">
                          Peu de donnees gagnantes — le plan s'appuiera principalement sur les defauts lifecycle
                        </p>
                      )}
                    </div>
                  </div>
                </label>

                {/* RESET option */}
                <label
                  className={`block p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedMode === 'RESET'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="creationMode"
                      checked={selectedMode === 'RESET'}
                      onChange={() => setSelectedMode('RESET')}
                      className="mt-0.5 accent-blue-600"
                    />
                    <div>
                      <span className="text-sm font-semibold text-slate-900">RESET — Repartir de zero</span>
                      <p className="text-xs text-slate-500 mt-1">
                        Ignore completement l'historique. Cree des campagnes neuves basees uniquement
                        sur la phase lifecycle et les mots-cles inferes du titre de ton livre.
                      </p>
                      <p className="text-xs text-blue-600 mt-1.5">
                        Ideal si tes campagnes actuelles sont trop chaotiques ou si tu veux un fresh start total
                      </p>
                    </div>
                  </div>
                </label>
              </div>

              {/* Contextual info box */}
              {hasExistingCampaigns && (
                <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-xs text-slate-500">
                    Tu as actuellement {existingCampaigns.length} campagne{existingCampaigns.length > 1 ? 's' : ''} active{existingCampaigns.length > 1 ? 's' : ''}.
                    {' '}A l'etape suivante, tu pourras choisir de les pauser ou de les conserver.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Strategy (pause existing) ── */}
          {step === 'strategy' && (
            <div>
              <p className="text-sm text-slate-600 mb-4">
                Que veux-tu faire de tes campagnes existantes ?
              </p>

              <div className="space-y-2 mb-4">
                {[
                  { value: 'keep' as PauseOption, label: 'Conserver mes campagnes existantes', desc: 'Les nouvelles campagnes s\'ajoutent a cote des existantes.' },
                  { value: 'pause-all' as PauseOption, label: 'Pauser TOUTES mes campagnes actives', desc: 'On repart a zero avec une structure propre. Les campagnes sont pausees, pas supprimees.' },
                  { value: 'pause-selected' as PauseOption, label: 'Choisir lesquelles pauser', desc: 'Selectionne manuellement les campagnes a mettre en pause.' },
                ].map(opt => (
                  <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${pauseOption === opt.value ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <input type="radio" name="pauseOpt" checked={pauseOption === opt.value} onChange={() => setPauseOption(opt.value)} className="mt-0.5 accent-brand-600" />
                    <div>
                      <span className="text-sm font-medium text-slate-900">{opt.label}</span>
                      <p className="text-xs text-slate-500">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </div>

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

              {/* Mode indicator */}
              <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-xs text-slate-500">
                  Mode selectionne : <strong className="text-slate-700">{selectedMode === 'HARVEST' ? 'HARVEST (optimiser l\'existant)' : 'RESET (repartir de zero)'}</strong>
                </p>
              </div>
            </div>
          )}

          {/* ── STEP 4: Plan Review (Strategic) ── */}
          {step === 'plan-review' && (
            <div>
              {planLoading && (
                <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-300 border-t-brand-600 rounded-full" />
                  Calcul du plan strategique ({selectedMode})...
                </div>
              )}

              {planError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                  {planError}
                </div>
              )}

              {planData && !planLoading && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm text-slate-600">
                        Plan strategique — phase <strong>{planData.lifecycleUsed}</strong>
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Mode : {planData.modeUsed === 'HARVEST' ? 'Optimisation existant' : 'Repartir de zero'}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                    >
                      {showAdvanced ? 'Masquer reglages avances' : 'Reglages avances'}
                    </button>
                  </div>

                  {/* Campaign cards */}
                  <div className="space-y-3 mb-4">
                    {planData.creationPlan.campaignsToCreate.map((c: CampaignToCreate, i: number) => {
                      const ov = getOverride(i);
                      const isExpanded = expandedExplanation === i;

                      return (
                        <div
                          key={i}
                          className={`rounded-lg border transition-all ${!ov.enabled ? 'opacity-40 border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'}`}
                        >
                          {/* Campaign header */}
                          <div className="p-3">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-slate-900">{c.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-mono">
                                  {TYPE_LABELS[c.type] || c.type}
                                </span>
                              </div>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={ov.enabled}
                                  onChange={() => updateOverride(i, { enabled: !ov.enabled })}
                                  className="accent-brand-600"
                                />
                                <span className="text-xs text-slate-500">{ov.enabled ? 'Actif' : 'Ignore'}</span>
                              </label>
                            </div>

                            <p className="text-xs text-slate-500 mb-2">{c.notesWhy}</p>

                            {/* Key metrics row */}
                            {ov.enabled && (
                              <div className="flex gap-3 text-xs">
                                <div className="flex items-center gap-1">
                                  <span className="text-slate-400">Budget:</span>
                                  {showAdvanced ? (
                                    <input
                                      type="number"
                                      step="1"
                                      min="1"
                                      max="100"
                                      value={ov.dailyBudget}
                                      onChange={(e) => updateOverride(i, { dailyBudget: Math.max(1, Number(e.target.value)) })}
                                      className="w-16 px-1 py-0.5 text-xs border border-slate-300 rounded text-right"
                                    />
                                  ) : (
                                    <span className="font-medium text-slate-700">{ov.dailyBudget}€/j</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-slate-400">Enchere:</span>
                                  {showAdvanced ? (
                                    <input
                                      type="number"
                                      step="0.05"
                                      min="0.10"
                                      max="5.00"
                                      value={ov.defaultBid}
                                      onChange={(e) => updateOverride(i, { defaultBid: Math.max(0.10, Number(e.target.value)) })}
                                      className="w-16 px-1 py-0.5 text-xs border border-slate-300 rounded text-right"
                                    />
                                  ) : (
                                    <span className="font-medium text-slate-700">{ov.defaultBid.toFixed(2)}€</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-slate-400">Strategie:</span>
                                  <span className="font-medium text-slate-700">{STRATEGY_LABELS[c.biddingStrategy] || c.biddingStrategy}</span>
                                </div>
                                {(ov.topOfSearchBoost > 0 || c.placementAdjustments) && (
                                  <div className="flex items-center gap-1">
                                    <span className="text-slate-400">Top:</span>
                                    {showAdvanced ? (
                                      <input
                                        type="number"
                                        step="5"
                                        min="0"
                                        max="100"
                                        value={ov.topOfSearchBoost}
                                        onChange={(e) => updateOverride(i, { topOfSearchBoost: Math.max(0, Number(e.target.value)) })}
                                        className="w-14 px-1 py-0.5 text-xs border border-slate-300 rounded text-right"
                                      />
                                    ) : (
                                      <span className="font-medium text-emerald-600">+{ov.topOfSearchBoost}%</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Seeds */}
                            {ov.enabled && c.seedKeywords && c.seedKeywords.length > 0 && (
                              <p className="text-xs text-emerald-600 mt-1.5">
                                {c.seedKeywords.length} mots-cles : {c.seedKeywords.slice(0, 4).join(', ')}{c.seedKeywords.length > 4 ? ` +${c.seedKeywords.length - 4}` : ''}
                              </p>
                            )}
                            {ov.enabled && c.seedAsins && c.seedAsins.length > 0 && (
                              <p className="text-xs text-blue-600 mt-0.5">
                                {c.seedAsins.length} ASINs cibles
                              </p>
                            )}
                            {ov.enabled && c.negativeKeywords && c.negativeKeywords.length > 0 && (
                              <p className="text-xs text-red-500 mt-0.5">
                                {c.negativeKeywords.length} negatifs
                              </p>
                            )}
                          </div>

                          {/* Explanation toggle */}
                          {ov.enabled && c.explanations && c.explanations.length > 0 && (
                            <div className="border-t border-slate-100">
                              <button
                                onClick={() => setExpandedExplanation(isExpanded ? null : i)}
                                className="w-full px-3 py-1.5 text-left text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
                              >
                                {isExpanded ? '▼ Masquer les explications' : '▶ Pourquoi ces choix ?'}
                              </button>
                              {isExpanded && (
                                <div className="px-3 pb-3 space-y-2">
                                  {c.explanations.map((ex: CampaignExplanation, j: number) => {
                                    const badge = DATASOURCE_BADGES[ex.dataSource] || DATASOURCE_BADGES.rule_based;
                                    return (
                                      <div key={j} className="text-xs">
                                        <div className="flex items-center gap-1.5 mb-0.5">
                                          <span className="font-medium text-slate-700 capitalize">{ex.parameter}</span>
                                          <span className="text-slate-400">→</span>
                                          <span className="font-medium text-slate-900">{ex.value}</span>
                                          <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${badge.bg} ${badge.text}`}>
                                            {badge.label}
                                          </span>
                                        </div>
                                        <p className="text-slate-500 leading-relaxed">{ex.reasoning}</p>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Budget total */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-sm font-medium text-slate-700">Budget total par jour</span>
                    <div className="text-right">
                      <span className="text-sm font-bold text-slate-900">{totalDailyBudget.toFixed(2)}€/j</span>
                      <span className="text-xs text-slate-400 block">~{(totalDailyBudget * 30).toFixed(0)}€/mois</span>
                    </div>
                  </div>

                  {/* Harvested assets summary */}
                  {planData.harvestedAssets && selectedMode === 'HARVEST' && (
                    <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                      <p className="text-xs font-semibold text-emerald-800 mb-1">Donnees recoltees (mode HARVEST)</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-emerald-700">
                        <span>{planData.harvestedAssets.winnerKeywords.length} mots-cles gagnants</span>
                        <span>{planData.harvestedAssets.winnerAsins.length} ASINs gagnants</span>
                        <span>{planData.harvestedAssets.winnerSearchTerms.length} termes de recherche</span>
                        <span>{planData.harvestedAssets.suggestedNegatives.length} negatifs suggeres</span>
                        {planData.harvestedAssets.avgWinningBid !== null && (
                          <span>CPC gagnants : {planData.harvestedAssets.avgWinningBid.toFixed(2)}€</span>
                        )}
                        {planData.harvestedAssets.topPlacementPerformance !== null && (
                          <span>Top of Search : x{planData.harvestedAssets.topPlacementPerformance.toFixed(1)}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Gaps (informational only) */}
                  {planData.gaps && planData.gaps.length > 0 && (
                    <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                      <p className="text-xs font-semibold text-amber-800 mb-1">Gaps detectes (informatif)</p>
                      <ul className="text-xs text-amber-700 space-y-0.5">
                        {planData.gaps.slice(0, 4).map((g, i) => (
                          <li key={i}>- {g.label}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── STEP 5: Recap ── */}
          {step === 'recap' && planData && (
            <div>
              <p className="text-sm font-medium text-slate-900 mb-3">Recapitulatif avant lancement</p>

              {/* Mode badge */}
              <div className="p-3 rounded-lg border border-slate-200 mb-3">
                <p className="text-xs font-medium text-slate-500 mb-1">Mode de creation</p>
                <p className="text-sm font-semibold text-slate-700">
                  {selectedMode === 'HARVEST' ? 'HARVEST — Optimisation depuis les donnees existantes' : 'RESET — Repartir de zero'}
                </p>
              </div>

              {/* Pause summary */}
              <div className="p-3 rounded-lg border border-slate-200 mb-3">
                <p className="text-xs font-medium text-slate-500 mb-1">Campagnes existantes</p>
                <p className="text-sm text-slate-700">
                  {pauseOption === 'keep' && 'Conservees telles quelles'}
                  {pauseOption === 'pause-all' && `Toutes pausees (${existingCampaigns.length} campagnes)`}
                  {pauseOption === 'pause-selected' && `${selectedCampaignIds.length} campagne(s) seront pausees`}
                </p>
              </div>

              {/* New campaigns summary */}
              <div className="p-3 rounded-lg border border-slate-200 mb-3">
                <p className="text-xs font-medium text-slate-500 mb-2">Campagnes a creer ({enabledCampaigns.length})</p>
                <div className="space-y-2">
                  {enabledCampaigns.map(({ campaign, index }) => {
                    const ov = getOverride(index);
                    return (
                      <div key={index} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{campaign.name}</span>
                          <span className="text-slate-400">{TYPE_LABELS[campaign.type] || campaign.type}</span>
                        </div>
                        <div className="flex items-center gap-3 text-slate-600">
                          <span>{ov.dailyBudget}€/j</span>
                          <span>{ov.defaultBid.toFixed(2)}€</span>
                          <span>{STRATEGY_LABELS[campaign.biddingStrategy] || campaign.biddingStrategy}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Budget total */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-brand-50 border border-brand-200 mb-3">
                <span className="text-sm font-medium text-brand-800">Budget total</span>
                <span className="text-sm font-bold text-brand-900">{totalDailyBudget.toFixed(2)}€/j (~{(totalDailyBudget * 30).toFixed(0)}€/mois)</span>
              </div>

              {/* Detailed explanations per campaign */}
              <div className="border border-slate-200 rounded-lg">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                  <p className="text-xs font-semibold text-slate-600">Pourquoi ce plan ? — Explications detaillees</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {enabledCampaigns.map(({ campaign, index }) => (
                    <div key={index} className="px-3 py-2">
                      <p className="text-xs font-semibold text-slate-700 mb-1">{campaign.name}</p>
                      {campaign.explanations.map((ex: CampaignExplanation, j: number) => {
                        const badge = DATASOURCE_BADGES[ex.dataSource] || DATASOURCE_BADGES.rule_based;
                        return (
                          <div key={j} className="flex items-start gap-1.5 text-[11px] mb-0.5">
                            <span className={`px-1 py-0 rounded text-[9px] font-medium flex-shrink-0 mt-0.5 ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                            <span className="text-slate-500">
                              <strong className="text-slate-700">{ex.parameter}</strong> = {ex.value} — {ex.reasoning}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 6a: Executing ── */}
          {step === 'executing' && (
            <div className="flex flex-col items-center justify-center py-8">
              <span className="animate-spin inline-block w-8 h-8 border-3 border-slate-200 border-t-brand-600 rounded-full mb-4" />
              <p className="text-sm font-medium text-slate-700">
                {execPhase === 'pausing' && 'Mise en pause des campagnes...'}
                {execPhase === 'creating' && 'Creation des nouvelles campagnes...'}
                {execPhase === 'done' && 'Finalisation...'}
              </p>
              <p className="text-xs text-slate-400 mt-2">Ne ferme pas cette fenetre.</p>
            </div>
          )}

          {/* ── STEP 6b: Result ── */}
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
                    Creation de campagnes ({selectedMode})
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
                          <span className={r.success ? 'text-emerald-600' : 'text-red-500'}>{r.success ? '✓' : '✗'}</span>
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
            {(['mode-choice', 'strategy', 'plan-review', 'recap'] as WizardStep[]).includes(step) && (
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
                  disabled={!canGoNext()}
                >
                  {step === 'recap' ? 'Lancer le rebuild' : 'Suivant'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
