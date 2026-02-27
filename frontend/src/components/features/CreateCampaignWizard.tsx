'use client';
import React, { useState, useMemo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { createBatchFromPlan, pauseBatchCampaigns, getWorkspaceId, triggerSync } from '@/lib/api/client';
import type { CreationPlan, CampaignToCreate, CampaignToPause, PauseStrategy, TopAction } from '@/lib/transforms/campaign-evolution';

// ── Props ───────────────────────────────────────────────────────

interface CreateCampaignWizardProps {
  bookId: string;
  creationPlan?: CreationPlan;
  topActions?: TopAction[];
  lifecyclePhase?: string;
  onClose: () => void;
  onCreated: () => void;
}

// ── Campaign type labels ─────────────────────────────────────────

const campaignTypeLabels: Record<string, string> = {
  SP_AUTO: 'SP Auto',
  SP_MANUAL_BROAD: 'SP Broad',
  SP_MANUAL_PHRASE: 'SP Phrase',
  SP_MANUAL_EXACT: 'SP Exact',
  SP_PRODUCT: 'SP Product',
  SP_CATEGORY: 'SP Catégorie',
  SB_VIDEO: 'SB Vidéo',
};

const biddingStrategyLabels: Record<string, string> = {
  DOWN_ONLY: 'Enchères dynamiques (baisser)',
  UP_DOWN: 'Enchères dynamiques (monter/baisser)',
  FIXED: 'Enchères fixes',
};

const targetingModeLabels: Record<string, string> = {
  AUTO: 'Automatique',
  MANUAL: 'Manuel',
};

// ── Per-campaign override state ──────────────────────────────────

interface CampaignOverride {
  dailyBudget: number;
  skip: boolean;
}

// ── Batch result types ──────────────────────────────────────────

interface BatchResult {
  planId: string;
  totalRequested: number;
  totalCreated: number;
  totalSkipped: number;
  totalFailed: number;
  results: Array<{
    index: number;
    name: string;
    success: boolean;
    message: string;
    alreadyCreated?: boolean;
    skipped?: boolean;
  }>;
  message: string;
}

// ── Component ───────────────────────────────────────────────────

export function CreateCampaignWizard({
  bookId,
  creationPlan,
  topActions,
  lifecyclePhase,
  onClose,
  onCreated,
}: CreateCampaignWizardProps) {
  const campaignsToCreate = creationPlan?.campaignsToCreate || [];
  const pauseStrategy = creationPlan?.pauseStrategy;
  const hasPauseStep = pauseStrategy && pauseStrategy.campaignsToPause.length > 0;

  // Per-campaign overrides
  const [overrides, setOverrides] = useState<CampaignOverride[]>(() =>
    campaignsToCreate.map((c) => ({ dailyBudget: c.dailyBudget, skip: false })),
  );

  const [step, setStep] = useState<'pause-review' | 'pausing' | 'review' | 'creating' | 'success' | 'error'>(
    hasPauseStep ? 'pause-review' : 'review',
  );
  const [error, setError] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [creatingIndex, setCreatingIndex] = useState(-1);
  const [pauseSkipped, setPauseSkipped] = useState(false);
  const [pauseResult, setPauseResult] = useState<{ paused: number; failed: number } | null>(null);

  // Total budget
  const totalDailyBudget = useMemo(
    () =>
      overrides.reduce(
        (sum, ov, i) => (ov.skip ? sum : sum + ov.dailyBudget),
        0,
      ),
    [overrides],
  );

  const activeCampaigns = overrides.filter((ov) => !ov.skip).length;

  // ── Override helpers ──────────────────────────────
  const updateOverride = (index: number, patch: Partial<CampaignOverride>) => {
    setOverrides((prev) =>
      prev.map((ov, i) => (i === index ? { ...ov, ...patch } : ov)),
    );
  };

  // ── Submit ────────────────────────────────────────
  const handleCreate = async () => {
    if (!creationPlan || campaignsToCreate.length === 0) return;

    setStep('creating');
    setError(null);
    setCreatingIndex(0);

    try {
      const dto = {
        workspaceId: getWorkspaceId(),
        bookId,
        planId: creationPlan.planId,
        fingerprint: creationPlan.fingerprint,
        lifecyclePhase,
        campaigns: campaignsToCreate.map((c) => ({
          name: c.name,
          type: c.type,
          targetingMode: c.targetingMode,
          dailyBudget: c.dailyBudget,
          biddingStrategy: c.biddingStrategy,
          seedKeywords: c.seedKeywords,
          seedAsins: c.seedAsins,
          notesWhy: c.notesWhy,
        })),
        overrides: overrides
          .map((ov, i) => ({
            index: i,
            dailyBudget: ov.dailyBudget,
            skip: ov.skip,
          }))
          .filter((ov) => ov.skip || ov.dailyBudget !== campaignsToCreate[ov.index]?.dailyBudget),
      };

      const result = await createBatchFromPlan(dto);
      setBatchResult(result);
      setStep('success');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Erreur lors de la création';
      setError(msg);
      setStep('error');
    }
  };

  // ── Pause existing campaigns ─────────────────────
  const handlePauseAndContinue = async () => {
    if (!pauseStrategy || pauseStrategy.campaignsToPause.length === 0) {
      setStep('review');
      return;
    }

    setStep('pausing');
    setError(null);

    try {
      const result = await pauseBatchCampaigns({
        workspaceId: getWorkspaceId(),
        bookId,
        campaignIds: pauseStrategy.campaignsToPause.map((c) => c.campaignId),
        reason: 'Rebuild: pause avant recréation via CreationPlan',
      });

      setPauseResult({ paused: result.paused, failed: result.failed });

      if (result.failed > 0 && result.paused === 0) {
        setError(`Échec de la mise en pause (${result.failed} erreur${result.failed > 1 ? 's' : ''}). La création est annulée.`);
        setStep('error');
        return;
      }

      setStep('review');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Erreur lors de la mise en pause';
      setError(msg);
      setStep('error');
    }
  };

  // ── Sync after creation ───────────────────────────
  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await triggerSync();
    } catch {
      // Non-critical
    } finally {
      setSyncing(false);
      onCreated();
    }
  };

  // ── Guard: no plan ──────────────────────────────
  if (!creationPlan || campaignsToCreate.length === 0) {
    return (
      <Modal open={true} onClose={onClose} title="Créer des campagnes" wide>
        <div className="py-6 text-center">
          <p className="text-sm text-slate-600">Aucun plan de création disponible pour ce livre.</p>
          <div className="mt-4">
            <Button variant="secondary" onClick={onClose}>Fermer</Button>
          </div>
        </div>
      </Modal>
    );
  }

  const inputClass = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500';

  return (
    <Modal open={true} onClose={onClose} title="Créer des campagnes" wide>
      {/* ── Step: Pause Review ── */}
      {step === 'pause-review' && pauseStrategy && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
            <p className="text-sm font-medium text-amber-900 mb-0.5">
              Étape 1 — Mettre en pause {pauseStrategy.campaignsToPause.length} campagne{pauseStrategy.campaignsToPause.length > 1 ? 's' : ''}
            </p>
            <p className="text-xs text-amber-700">
              Avant de créer les nouvelles campagnes, il est recommandé de pauser les campagnes ci-dessous pour éviter la cannibalisation.
              {pauseStrategy.totalBudgetToSave > 0 && (
                <> Économie estimée : {pauseStrategy.totalBudgetToSave.toFixed(0)}€/jour.</>
              )}
            </p>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {pauseStrategy.campaignsToPause.map((cp, i) => (
              <div
                key={i}
                className="p-3 rounded-lg border border-slate-200 bg-white"
              >
                <p className="text-sm font-medium text-slate-900">{cp.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{cp.reason}</p>
                {cp.harvestedKeywords && cp.harvestedKeywords.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <span className="text-[10px] text-slate-400 mr-1">Keywords récupérés :</span>
                    {cp.harvestedKeywords.slice(0, 5).map((kw, ki) => (
                      <span key={ki} className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                        {kw}
                      </span>
                    ))}
                    {cp.harvestedKeywords.length > 5 && (
                      <span className="text-[10px] text-slate-400">+{cp.harvestedKeywords.length - 5}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <button
              onClick={() => { setPauseSkipped(true); setStep('review'); }}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              Passer cette étape
            </button>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={onClose}>Annuler</Button>
              <Button variant="primary" onClick={handlePauseAndContinue}>
                Pauser et continuer
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Pausing ── */}
      {step === 'pausing' && (
        <div className="text-center py-8">
          <svg className="animate-spin h-8 w-8 text-amber-600 mx-auto mb-3" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-slate-600">Mise en pause des campagnes...</p>
          <p className="text-xs text-slate-400 mt-1">Communication avec Amazon Ads</p>
        </div>
      )}

      {/* ── Step: Review ── */}
      {step === 'review' && (
        <div className="space-y-4">
          {/* Pause result banner */}
          {pauseResult && pauseResult.paused > 0 && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <p className="text-xs text-emerald-700">
                {pauseResult.paused} campagne{pauseResult.paused > 1 ? 's' : ''} mise{pauseResult.paused > 1 ? 's' : ''} en pause avec succès.
                {pauseResult.failed > 0 && ` (${pauseResult.failed} échec${pauseResult.failed > 1 ? 's' : ''})`}
              </p>
            </div>
          )}

          {/* Summary header */}
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
            <p className="text-sm font-medium text-blue-900 mb-0.5">
              Plan de création — {campaignsToCreate.length} campagne{campaignsToCreate.length > 1 ? 's' : ''}
            </p>
            <p className="text-xs text-blue-700">
              Budget journalier total : {totalDailyBudget.toFixed(0)}€/jour (~{(totalDailyBudget * 30).toFixed(0)}€/mois)
            </p>
          </div>

          {/* Campaign list */}
          <div className="space-y-3">
            {campaignsToCreate.map((campaign, index) => {
              const ov = overrides[index];
              const isSkipped = ov?.skip;

              return (
                <div
                  key={index}
                  className={`p-4 rounded-lg border transition-opacity ${
                    isSkipped
                      ? 'border-slate-200 bg-slate-50 opacity-50'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Campaign header */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-brand-100 text-brand-700 border border-brand-200">
                          {campaignTypeLabels[campaign.type] || campaign.type}
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                          {targetingModeLabels[campaign.targetingMode] || campaign.targetingMode}
                        </span>
                      </div>

                      {/* Campaign name */}
                      <p className="text-sm font-medium text-slate-900 truncate">{campaign.name}</p>

                      {/* Why */}
                      <p className="text-xs text-slate-500 mt-0.5">{campaign.notesWhy}</p>

                      {/* Seed keywords */}
                      {campaign.seedKeywords && campaign.seedKeywords.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {campaign.seedKeywords.slice(0, 5).map((kw, ki) => (
                            <span key={ki} className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                              {kw}
                            </span>
                          ))}
                          {campaign.seedKeywords.length > 5 && (
                            <span className="text-[10px] text-slate-400">+{campaign.seedKeywords.length - 5}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right side: budget override + skip */}
                    <div className="flex flex-col items-end gap-2 min-w-[140px]">
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-500">Budget/j</label>
                        <input
                          type="number"
                          min={1}
                          step={0.5}
                          value={ov?.dailyBudget ?? campaign.dailyBudget}
                          onChange={(e) => updateOverride(index, { dailyBudget: Number(e.target.value) })}
                          disabled={isSkipped}
                          className="w-20 px-2 py-1 text-sm border border-slate-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100"
                        />
                        <span className="text-xs text-slate-400">€</span>
                      </div>
                      <button
                        onClick={() => updateOverride(index, { skip: !isSkipped })}
                        className={`text-xs transition-colors ${
                          isSkipped
                            ? 'text-brand-600 hover:text-brand-700'
                            : 'text-slate-400 hover:text-red-500'
                        }`}
                      >
                        {isSkipped ? 'Réactiver' : 'Ignorer'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <p className="text-xs text-slate-400">
              {activeCampaigns} campagne{activeCampaigns > 1 ? 's' : ''} active{activeCampaigns > 1 ? 's' : ''}
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={onClose}>Annuler</Button>
              <Button
                variant="primary"
                onClick={handleCreate}
                disabled={activeCampaigns === 0}
              >
                Créer {activeCampaigns} campagne{activeCampaigns > 1 ? 's' : ''} sur Amazon Ads
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Creating ── */}
      {step === 'creating' && (
        <div className="text-center py-8">
          <svg className="animate-spin h-8 w-8 text-brand-600 mx-auto mb-3" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-slate-600">
            Création des campagnes en cours...
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Communication avec Amazon Ads — cela peut prendre jusqu'à 1 minute
          </p>
          {/* Progress indicator */}
          <div className="mt-4 flex justify-center gap-1.5">
            {campaignsToCreate.map((_, i) => {
              const ov = overrides[i];
              if (ov?.skip) return null;
              return (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i < creatingIndex ? 'bg-emerald-400' : i === creatingIndex ? 'bg-brand-600 animate-pulse' : 'bg-slate-200'
                  }`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Step: Success ── */}
      {step === 'success' && batchResult && (
        <div className="py-6">
          {/* Header icon */}
          <div className="text-center mb-4">
            {batchResult.totalFailed === 0 ? (
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : (
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
            )}
            <p className="text-sm font-medium text-slate-900">{batchResult.message}</p>
          </div>

          {/* Per-campaign results */}
          <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
            {batchResult.results.map((r) => (
              <div
                key={r.index}
                className={`flex items-center justify-between p-2.5 rounded-lg border ${
                  r.success
                    ? r.alreadyCreated
                      ? 'bg-slate-50 border-slate-200'
                      : r.skipped
                        ? 'bg-slate-50 border-slate-200'
                        : 'bg-emerald-50 border-emerald-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    r.success
                      ? r.skipped ? 'bg-slate-200 text-slate-500' : 'bg-emerald-200 text-emerald-700'
                      : 'bg-red-200 text-red-700'
                  }`}>
                    {r.success ? (r.skipped ? '−' : '✓') : '✗'}
                  </span>
                  <span className="text-sm text-slate-700 truncate">{r.name}</span>
                </div>
                <span className={`text-xs flex-shrink-0 ml-2 ${
                  r.success ? 'text-slate-500' : 'text-red-600'
                }`}>
                  {r.alreadyCreated ? 'Déjà créé' : r.skipped ? 'Ignoré' : r.success ? 'Créé' : r.message}
                </span>
              </div>
            ))}
          </div>

          {/* Sync CTA */}
          <div className="flex flex-col items-center gap-2 pt-3 border-t border-slate-100">
            <Button
              variant="primary"
              onClick={handleSyncNow}
              disabled={syncing}
            >
              {syncing ? 'Synchronisation...' : 'Synchroniser & Fermer'}
            </Button>
            <button
              onClick={onCreated}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              Fermer sans synchroniser
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Error ── */}
      {step === 'error' && (
        <div className="text-center py-6">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-900 mb-1">Échec de la création</p>
          <div className="mx-auto max-w-sm">
            <p className="text-xs text-red-600 mb-4">{error}</p>
          </div>

          {/* Rate limit / auth hints */}
          {error && (error.includes('rate limit') || error.includes('surchargé') || error.includes('Authentification') || error.includes('expiré')) && (
            <div className="mb-3 p-2 rounded bg-blue-50 border border-blue-200 mx-auto max-w-sm">
              <p className="text-xs text-blue-700">
                {error.includes('rate limit') || error.includes('surchargé')
                  ? 'Amazon Ads limite les requêtes. Attendez 1-2 minutes avant de réessayer.'
                  : 'Votre connexion Amazon Ads a expiré. Reconnectez votre compte dans les paramètres.'}
              </p>
            </div>
          )}

          <div className="flex justify-center gap-3">
            <Button variant="secondary" onClick={onClose}>Annuler</Button>
            <Button variant="primary" onClick={() => setStep('review')}>Réessayer</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
