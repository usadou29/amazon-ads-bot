'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { executeMacroAction } from '@/lib/api/client';
import type { MacroSuggestionDTO } from './MacroSuggestionsBlock';

// ── Strategy Labels ───────────────────────────────────

const BIDDING_LABELS: Record<string, string> = {
  'fixed': 'Enchères fixes',
  'down_only': 'Baisses uniquement',
  'up_and_down': 'Hausse et baisse',
};

// ── Component ─────────────────────────────────────────

interface MacroActionModalProps {
  suggestion: MacroSuggestionDTO;
  workspaceId?: string;
  onClose: () => void;
  onActionExecuted?: () => void;
}

export function MacroActionModal({ suggestion, workspaceId, onClose, onActionExecuted }: MacroActionModalProps) {
  const [applying, setApplying] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExecute = async () => {
    if (!workspaceId || !suggestion.executable || !suggestion.recommended) return;

    setApplying(true);
    setError(null);

    try {
      const result = await executeMacroAction({
        workspaceId,
        campaignId: suggestion.campaignId,
        suggestionId: suggestion.id,
        actionType: suggestion.actionType,
        recommended: suggestion.recommended,
      });

      if (result.success) {
        setSuccess('Action appliquée avec succès !');
        onActionExecuted?.();
        setTimeout(() => onClose(), 2000);
      } else {
        setError(result.error || 'Erreur lors de l\'exécution');
      }
    } catch (err: any) {
      setError(err.message || 'Erreur réseau');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title={suggestion.title} wide>
      <div className="space-y-4">

        {/* Success / Error */}
        {success && (
          <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3">
            <p className="text-sm text-emerald-700">{success}</p>
          </div>
        )}
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Section: Pourquoi maintenant */}
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Pourquoi maintenant
          </h4>
          <p className="text-sm text-slate-700">{suggestion.why}</p>

          {/* Evidence metrics */}
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestion.evidence.acosStrategic != null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                ACoS stratégique : {suggestion.evidence.acosStrategic.toFixed(1)}%
              </span>
            )}
            {suggestion.evidence.acosTrend != null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                ACoS tendance : {suggestion.evidence.acosTrend.toFixed(1)}%
              </span>
            )}
            {suggestion.evidence.cvrStrategic != null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                CVR stratégique : {suggestion.evidence.cvrStrategic.toFixed(1)}%
              </span>
            )}
            {suggestion.evidence.spendShareImpacted != null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                {Math.round(suggestion.evidence.spendShareImpacted * 100)}% du budget impacté
              </span>
            )}
            {suggestion.evidence.budgetUtilization != null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                Utilisation budget : {Math.round(suggestion.evidence.budgetUtilization * 100)}%
              </span>
            )}
          </div>
        </div>

        {/* Section: Actuel vs Recommandé */}
        {suggestion.executable && suggestion.recommended && (
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Changement proposé
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {/* Current */}
              <div className="rounded-md bg-slate-50 border border-slate-200 p-3">
                <p className="text-[10px] font-medium text-slate-400 uppercase mb-1">Actuel</p>
                {suggestion.current.biddingStrategy && (
                  <p className="text-sm text-slate-700">
                    Stratégie : <span className="font-medium">{BIDDING_LABELS[suggestion.current.biddingStrategy] || suggestion.current.biddingStrategy}</span>
                  </p>
                )}
                {suggestion.current.budget != null && (
                  <p className="text-sm text-slate-700">
                    Budget : <span className="font-medium">{suggestion.current.budget.toFixed(2)} € / jour</span>
                  </p>
                )}
                {suggestion.current.placements && (
                  <div className="text-sm text-slate-700">
                    <p>Tête de recherche : <span className="font-medium">+{suggestion.current.placements.topOfSearch}%</span></p>
                    <p>Pages produit : <span className="font-medium">+{suggestion.current.placements.productPages}%</span></p>
                    <p>Reste : <span className="font-medium">+{suggestion.current.placements.restOfSearch}%</span></p>
                  </div>
                )}
              </div>

              {/* Recommended */}
              <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3">
                <p className="text-[10px] font-medium text-emerald-500 uppercase mb-1">Recommandé</p>
                {suggestion.recommended.biddingStrategy && (
                  <p className="text-sm text-emerald-800">
                    Stratégie : <span className="font-semibold">{BIDDING_LABELS[suggestion.recommended.biddingStrategy] || suggestion.recommended.biddingStrategy}</span>
                  </p>
                )}
                {suggestion.recommended.budget != null && (
                  <p className="text-sm text-emerald-800">
                    Budget : <span className="font-semibold">{suggestion.recommended.budget.toFixed(2)} € / jour</span>
                  </p>
                )}
                {suggestion.recommended.placements && (
                  <div className="text-sm text-emerald-800">
                    <p>Tête de recherche : <span className="font-semibold">+{suggestion.recommended.placements.topOfSearch}%</span></p>
                    <p>Pages produit : <span className="font-semibold">+{suggestion.recommended.placements.productPages}%</span></p>
                    <p>Reste : <span className="font-semibold">+{suggestion.recommended.placements.restOfSearch}%</span></p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Non-executable: checklist */}
        {!suggestion.executable && (
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Checklist
            </h4>
            <ul className="space-y-1">
              {suggestion.bullets.map((bullet, i) => (
                <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                  <span className="text-slate-400">☐</span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Guardrails info */}
        {suggestion.guardrails && (
          <div className="text-xs text-slate-400">
            {suggestion.guardrails.cooldownDays && (
              <p>Après application, une période d'observation de {suggestion.guardrails.cooldownDays} jours sera appliquée.</p>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
          >
            Fermer
          </button>
          {suggestion.executable && workspaceId && (
            <button
              onClick={handleExecute}
              disabled={applying || !!success}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {applying ? 'Application...' : success ? 'Appliqué ✓' : 'Appliquer'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
