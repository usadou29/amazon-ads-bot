'use client';
import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { createCampaignFromPlan, getWorkspaceId, triggerSync } from '@/lib/api/client';
import type { TopAction } from '@/lib/transforms/campaign-evolution';

// ── Props ───────────────────────────────────────────────────────

interface CreateCampaignWizardProps {
  bookId: string;
  action: TopAction;
  lifecyclePhase?: string;
  onClose: () => void;
  onCreated: () => void;
}

// ── Component ───────────────────────────────────────────────────

export function CreateCampaignWizard({ bookId, action, lifecyclePhase, onClose, onCreated }: CreateCampaignWizardProps) {
  const payload = action.payload || {};

  // Form state with defaults from plan
  const [campaignType, setCampaignType] = useState<string>(payload.campaignType || 'sponsoredProducts');
  const [targetingType, setTargetingType] = useState<string>(payload.targetingType || 'auto');
  const [matchTypes, setMatchTypes] = useState<string[]>(payload.matchTypes || []);
  const [dailyBudget, setDailyBudget] = useState<number>(payload.suggestedDailyBudget || payload.dailyBudget || 10);
  const [seedKeywords, setSeedKeywords] = useState<string>(
    (payload.keywords || []).join('\n'),
  );

  const [step, setStep] = useState<'review' | 'creating' | 'success' | 'syncing' | 'error'>('review');
  const [error, setError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);

  const inputClass = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500';

  // ── Labels ──────────────────────────────────────
  const campaignTypeLabels: Record<string, string> = {
    sponsoredProducts: 'Sponsored Products (SP)',
    sponsoredBrands: 'Sponsored Brands (SB)',
    sponsoredDisplay: 'Sponsored Display (SD)',
  };

  const targetingTypeLabels: Record<string, string> = {
    auto: 'Automatique',
    manual: 'Manuel',
  };

  const matchTypeLabels: Record<string, string> = {
    exact: 'Exact',
    phrase: 'Phrase',
    broad: 'Broad',
  };

  // ── Submit ────────────────────────────────────────
  const handleCreate = async () => {
    setStep('creating');
    setError(null);

    try {
      const result = await createCampaignFromPlan({
        workspaceId: getWorkspaceId(),
        bookId,
        planActionType: action.actionType,
        planPayload: {
          campaignType,
          targetingType,
          matchTypes,
          dailyBudget,
          keywords: seedKeywords.split('\n').map((k) => k.trim()).filter(Boolean),
        },
        lifecyclePhase,
      });
      setCreatedResult(result);
      setStep('success');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Erreur lors de la création';
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
      // Sync failure is non-critical — campaign was already created
    } finally {
      setSyncing(false);
      onCreated();
    }
  };

  // ── Toggle match type ─────────────────────────────
  const toggleMatchType = (mt: string) => {
    setMatchTypes((prev) =>
      prev.includes(mt) ? prev.filter((m) => m !== mt) : [...prev, mt],
    );
  };

  return (
    <Modal open={true} onClose={onClose} title="Créer une campagne" wide>
      {/* ── Step: Review ── */}
      {step === 'review' && (
        <div className="space-y-4">
          {/* Recommendation context */}
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
            <p className="text-sm font-medium text-blue-900 mb-0.5">Pourquoi cette campagne ?</p>
            <p className="text-sm text-blue-800">{action.description}</p>
          </div>

          {/* Campaign Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type de campagne</label>
            <select
              value={campaignType}
              onChange={(e) => setCampaignType(e.target.value)}
              className={inputClass}
            >
              {Object.entries(campaignTypeLabels).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          {/* Targeting Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Ciblage</label>
            <div className="flex gap-2">
              {Object.entries(targetingTypeLabels).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setTargetingType(val)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                    targetingType === val
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Match Types (only for manual) */}
          {targetingType === 'manual' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Types de correspondance</label>
              <div className="flex gap-2">
                {Object.entries(matchTypeLabels).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => toggleMatchType(val)}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                      matchTypes.includes(val)
                        ? 'bg-brand-100 text-brand-700 border-brand-300'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Daily Budget */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Budget journalier (€)</label>
            <input
              type="number"
              min={1}
              step={0.5}
              value={dailyBudget}
              onChange={(e) => setDailyBudget(Number(e.target.value))}
              className={inputClass}
            />
            <p className="text-xs text-slate-400 mt-1">Budget mensuel estimé : ~{(dailyBudget * 30).toFixed(0)}€</p>
          </div>

          {/* Seed Keywords (for manual targeting) */}
          {targetingType === 'manual' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Mots-clés (un par ligne)
              </label>
              <textarea
                value={seedKeywords}
                onChange={(e) => setSeedKeywords(e.target.value)}
                placeholder="thriller psychologique&#10;roman policier&#10;suspense français"
                rows={4}
                className={inputClass}
              />
              <p className="text-xs text-slate-400 mt-1">
                {seedKeywords.split('\n').filter((k) => k.trim()).length} mot(s)-clé(s)
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <Button variant="secondary" onClick={onClose}>Annuler</Button>
            <Button variant="primary" onClick={handleCreate}>
              Créer sur Amazon Ads
            </Button>
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
          <p className="text-sm text-slate-600">Création de la campagne en cours...</p>
          <p className="text-xs text-slate-400 mt-1">Communication avec Amazon Ads — cela peut prendre quelques secondes</p>
        </div>
      )}

      {/* ── Step: Success ── */}
      {step === 'success' && (
        <div className="text-center py-6">
          <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          {createdResult?.alreadyCreated ? (
            <>
              <p className="text-sm font-medium text-slate-900 mb-1">Campagne déjà existante</p>
              <p className="text-xs text-amber-600 mb-2">Cette campagne a déjà été créée — pas de doublon.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-900 mb-1">Campagne créée avec succès !</p>
            </>
          )}

          {createdResult?.campaignName && (
            <p className="text-xs text-slate-600 mb-1 font-medium">{createdResult.campaignName}</p>
          )}
          {createdResult?.amazonCampaignId && (
            <p className="text-xs text-slate-400 mb-1">ID Amazon : {createdResult.amazonCampaignId}</p>
          )}

          {/* Keyword warning */}
          {createdResult?.message?.includes('mots-clés') && createdResult?.keywordsCreated === 0 && (
            <div className="mt-2 p-2 rounded bg-amber-50 border border-amber-200">
              <p className="text-xs text-amber-700">
                Les mots-clés n'ont pas pu être ajoutés automatiquement. Vous pouvez les ajouter manuellement depuis Amazon Ads.
              </p>
            </div>
          )}

          {/* Sync CTA */}
          <div className="mt-4 flex flex-col items-center gap-2">
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

          {/* Rate limit / timeout hint */}
          {(error?.includes('rate limit') || error?.includes('surchargé') || error?.includes('timeout') || error?.includes('expiré')) && (
            <div className="mb-3 p-2 rounded bg-blue-50 border border-blue-200 mx-auto max-w-sm">
              <p className="text-xs text-blue-700">
                {error.includes('rate limit') || error.includes('surchargé')
                  ? 'Amazon Ads limite les requêtes. Attendez 1-2 minutes avant de réessayer.'
                  : error.includes('Authentification')
                    ? 'Votre connexion Amazon Ads a expiré. Reconnectez votre compte dans les paramètres.'
                    : 'La connexion a été interrompue. Réessayez dans quelques instants.'}
              </p>
            </div>
          )}

          {/* Partial failure hint */}
          {error?.includes('ID:') && (
            <div className="mb-3 p-2 rounded bg-amber-50 border border-amber-200 mx-auto max-w-sm">
              <p className="text-xs text-amber-700">
                La campagne a été partiellement créée sur Amazon. Vérifiez votre tableau de bord Amazon Ads.
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
