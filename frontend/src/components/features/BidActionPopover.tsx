'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchActionSuggestion,
  executeDirectAction,
  type ActionSuggestionRequest,
} from '@/lib/api/client';
import { t } from '@/lib/i18n';

// ── Types ─────────────────────────────────────────────

interface BidActionPopoverProps {
  entityKey: string;
  entityType: 'keyword' | 'target';
  entityName: string;
  currentBid: number | null;
  workspaceId: string;
  acosTarget: number;
  lifecyclePhase?: string;
  actionType: 'bid_up' | 'bid_down';
  onClose: () => void;
  onActionExecuted?: () => void;
}

interface SuggestionData {
  currentBid: number;
  bidCalculation: {
    recommendedBid: number | null;
    explanation: string;
    eligibility: string;
  };
  amazonBid?: {
    suggested: number;
    rangeMin: number;
    rangeMax: number;
  };
  cooldown?: {
    active: boolean;
    daysSinceChange: number;
    cooldownDays: number;
    remainingDays: number;
    lastChangeType: string;
    previousBid: number;
    newBid: number;
    lastChangeAt: string;
  };
}

// ── Composant ─────────────────────────────────────────

export function BidActionPopover({
  entityKey,
  entityType,
  entityName,
  currentBid,
  workspaceId,
  acosTarget,
  lifecyclePhase,
  actionType,
  onClose,
  onActionExecuted,
}: BidActionPopoverProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SuggestionData | null>(null);
  const [applying, setApplying] = useState(false);
  const [success, setSuccess] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Fermer au clic extérieur
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Fetch la suggestion
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const dto: ActionSuggestionRequest = {
      workspaceId,
      entityKey,
      entityType,
      acosTarget,
      lifecyclePhase,
      actionType,
    };

    fetchActionSuggestion(dto)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.message || err.message || 'Erreur');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [workspaceId, entityKey, entityType, acosTarget, lifecyclePhase]);

  const handleApply = useCallback(async () => {
    if (!data?.bidCalculation.recommendedBid) return;
    setApplying(true);
    try {
      await executeDirectAction({
        workspaceId,
        entityKey,
        entityType,
        actionType: 'adjust_bid',
        newBid: data.bidCalculation.recommendedBid,
        rationale: data.bidCalculation.explanation,
      });
      setSuccess(true);
      setTimeout(() => {
        onActionExecuted?.();
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Erreur');
    } finally {
      setApplying(false);
    }
  }, [data, workspaceId, entityKey, entityType, onActionExecuted, onClose]);

  const isUp = actionType === 'bid_up';

  return (
    <>
      {/* Backdrop semi-transparent */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div
        ref={popoverRef}
        className="fixed z-50 w-[340px] rounded-xl border border-slate-200 bg-white shadow-2xl"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
      {/* En-tête */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-sm ${isUp ? 'text-emerald-600' : 'text-amber-600'}`}>
            {isUp ? '▲' : '▼'}
          </span>
          <span className="text-xs font-semibold text-slate-800 truncate max-w-[220px]">
            {entityName}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 transition-colors p-0.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Contenu */}
      <div className="px-3.5 py-3">
        {/* Success */}
        {success && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-700 text-center font-medium">
            Enchère mise à jour
          </div>
        )}

        {/* Loading */}
        {loading && !success && (
          <div className="flex flex-col items-center gap-2 py-4">
            <div className="w-5 h-5 border-2 border-slate-200 border-t-brand-500 rounded-full animate-spin" />
            <span className="text-xs text-slate-400">Chargement des enchères Amazon…</span>
          </div>
        )}

        {/* Error */}
        {error && !loading && !success && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-600">
            {error}
          </div>
        )}

        {/* Data */}
        {data && !loading && !success && (
          <div className="space-y-3">
            {/* Cooldown block */}
            {data.cooldown?.active && (
              <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-sm">&#9203;</span>
                  <span className="text-xs font-semibold text-indigo-700">
                    En observation (J+{data.cooldown.daysSinceChange}/{data.cooldown.cooldownDays})
                  </span>
                </div>
                <p className="text-[11px] text-indigo-600 leading-relaxed">
                  Enchère {data.cooldown.lastChangeType === 'bid_up' ? 'augmentée' : 'baissée'} le{' '}
                  {new Date(data.cooldown.lastChangeAt).toLocaleDateString('fr-FR')}.
                  Encore {data.cooldown.remainingDays}j avant de pouvoir modifier.
                </p>
              </div>
            )}

            {/* Ligne: Enchère actuelle */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Enchère actuelle</span>
              <span className="text-sm font-semibold text-slate-800 tabular-nums">
                {data.currentBid.toFixed(2)} €
              </span>
            </div>

            {/* Ligne: Enchère suggérée Amazon */}
            {!data.cooldown?.active && data.amazonBid && (
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-amber-700 font-medium">Amazon suggère</span>
                  <span className="text-sm font-bold text-amber-700 tabular-nums">
                    {data.amazonBid.suggested.toFixed(2)} €
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[10px] text-amber-500">Fourchette</span>
                  <span className="text-[11px] text-amber-600 tabular-nums">
                    {data.amazonBid.rangeMin.toFixed(2)} € – {data.amazonBid.rangeMax.toFixed(2)} €
                  </span>
                </div>
              </div>
            )}

            {!data.cooldown?.active && !data.amazonBid && (
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                <span className="text-xs text-slate-400 italic">Enchère Amazon non disponible pour ce {entityType === 'keyword' ? 'mot-clé' : 'ciblage'}</span>
              </div>
            )}

            {/* Ligne: Notre recommandation */}
            {!data.cooldown?.active && data.bidCalculation.recommendedBid != null && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Notre recommandation</span>
                <span className={`text-sm font-bold tabular-nums ${isUp ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {data.bidCalculation.recommendedBid.toFixed(2)} €
                </span>
              </div>
            )}

            {/* Explication courte */}
            {!data.cooldown?.active && data.bidCalculation.explanation && (
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {data.bidCalculation.explanation}
              </p>
            )}

            {/* Bouton Appliquer — désactivé si cooldown */}
            {!data.cooldown?.active && data.bidCalculation.recommendedBid != null && (
              <button
                onClick={handleApply}
                disabled={applying}
                className={`w-full rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors ${
                  applying
                    ? 'bg-slate-300 cursor-not-allowed'
                    : isUp
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {applying ? 'Application…' : `Appliquer ${data.bidCalculation.recommendedBid.toFixed(2)} €`}
              </button>
            )}

            {!data.cooldown?.active && data.bidCalculation.recommendedBid == null && (
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-xs text-blue-600">
                Pas assez de données pour calculer une enchère recommandée.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
