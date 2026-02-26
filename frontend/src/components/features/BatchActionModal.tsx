'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import {
  fetchBatchSuggestions,
  executeBatchDirect,
  type BatchSuggestionItem,
  type BatchSuggestionsRequest,
  type BatchExecuteRequest,
  type BatchExecuteResponse,
} from '@/lib/api/client';

// ── Types ───────────────────────────────────────────

interface BatchActionModalProps {
  open: boolean;
  onClose: () => void;
  campaignName: string;
  workspaceId: string;
  acosTarget: number;
  lifecyclePhase?: string;
  entities: Array<{
    entityKey: string;
    entityType: 'keyword' | 'target';
    entityName: string;
    currentBid: number | null;
    insight?: any;
    cooldown?: { active: boolean };
  }>;
  onActionExecuted?: () => void;
}

type Stage = 'loading' | 'review' | 'executing' | 'done';

// ── Component ───────────────────────────────────────

export function BatchActionModal({
  open,
  onClose,
  campaignName,
  workspaceId,
  acosTarget,
  lifecyclePhase,
  entities,
  onActionExecuted,
}: BatchActionModalProps) {
  const [stage, setStage] = useState<Stage>('loading');
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<BatchSuggestionItem[]>([]);
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set());
  const [executeResult, setExecuteResult] = useState<BatchExecuteResponse | null>(null);

  // Fetch suggestions on mount
  useEffect(() => {
    if (open && stage === 'loading') {
      fetchSuggestions();
    }
  }, [open, stage]);

  const fetchSuggestions = async () => {
    setError(null);
    try {
      const dto: BatchSuggestionsRequest = {
        workspaceId,
        entities: entities.map((e) => ({ entityKey: e.entityKey, entityType: e.entityType })),
        acosTarget,
        lifecyclePhase,
      };
      const response = await fetchBatchSuggestions(dto);
      setSuggestions(response.suggestions || []);

      // Pre-select eligible actions with direction
      const defaultSelected = new Set<string>();
      (response.suggestions || []).forEach((item: BatchSuggestionItem) => {
        if (item.eligible && item.direction) {
          defaultSelected.add(item.entityKey);
        }
      });
      setSelectedActions(defaultSelected);
      setStage('review');
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Erreur lors du chargement des suggestions');
      setStage('review');
    }
  };

  const handleToggleAction = (entityKey: string) => {
    const newSelected = new Set(selectedActions);
    if (newSelected.has(entityKey)) {
      newSelected.delete(entityKey);
    } else {
      newSelected.add(entityKey);
    }
    setSelectedActions(newSelected);
  };

  const handleApplyActions = async () => {
    setStage('executing');
    setError(null);
    try {
      // Build actions for all selected items that are eligible and have a direction
      const actionsToExecute = suggestions
        .filter((item): item is BatchSuggestionItem & { recommendedBid: number } =>
          selectedActions.has(item.entityKey) && item.eligible && !!item.direction && item.recommendedBid != null)
        .map((item) => ({
          entityKey: item.entityKey,
          entityType: item.entityType,
          actionType: 'adjust_bid' as const,
          newBid: item.recommendedBid,
          rationale: `Batch: ${item.diagnosisCode}`,
        }));

      if (actionsToExecute.length === 0) {
        setError('Aucune action valide à exécuter');
        setStage('review');
        return;
      }

      const dto: BatchExecuteRequest = {
        workspaceId,
        actions: actionsToExecute,
        lifecyclePhase,
      };

      const result = await executeBatchDirect(dto);
      setExecuteResult(result);
      setStage('done');

      // Auto-close after 2 seconds
      setTimeout(() => {
        onActionExecuted?.();
        onClose();
      }, 2000);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Erreur lors de l\'exécution des actions');
      setStage('review');
    }
  };

  const getActionBadgeColor = (item: BatchSuggestionItem) => {
    if (!item.eligible) return 'bg-slate-100 text-slate-600 border-slate-200';
    if (item.cooldownActive) return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    if (item.direction === 'bid_up') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    if (item.direction === 'bid_down') return 'bg-amber-100 text-amber-700 border-amber-200';
    return 'bg-slate-100 text-slate-600 border-slate-200';
  };

  const getActionBadgeLabel = (item: BatchSuggestionItem) => {
    if (!item.eligible) return 'Inéligible';
    if (item.cooldownActive) return 'Observation';
    if (item.direction === 'bid_up') return 'Hausse';
    if (item.direction === 'bid_down') return 'Baisse';
    return 'Aucune';
  };

  const calculateDeltaPercent = (current: number, recommended: number | null) => {
    if (recommended === null) return null;
    return (((recommended - current) / current) * 100).toFixed(1);
  };

  const selectedCount = selectedActions.size;
  const eligibleCount = suggestions.filter((s) => s.eligible && s.direction).length;

  return (
    <Modal open={open} onClose={onClose} title={`Actions par lot - ${campaignName}`} wide>
      {/* Loading state */}
      {stage === 'loading' && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-pulse text-sm text-slate-500">Chargement des suggestions...</div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Review stage */}
      {stage === 'review' && suggestions.length > 0 && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{selectedCount}</span> action{selectedCount !== 1 ? 's' : ''} sélectionnée{selectedCount !== 1 ? 's' : ''} sur{' '}
              <span className="font-semibold text-slate-900">{eligibleCount}</span> entité{eligibleCount !== 1 ? 's' : ''} éligible{eligibleCount !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Suggestions table */}
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 w-10">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Entité</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600">Enchère actuelle</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600">Enchère recommandée</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600">Action</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 w-12">Inclure</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((item, idx) => {
                  const isSelected = selectedActions.has(item.entityKey);
                  const canSelect = item.eligible && item.direction && item.recommendedBid != null;
                  const delta = calculateDeltaPercent(item.currentBid, item.recommendedBid);

                  return (
                    <tr key={item.entityKey} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="px-4 py-3 text-xs text-slate-500">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-900 truncate">{item.entityName}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{item.diagnosisCode}</div>
                      </td>
                      <td className="px-4 py-3 text-center text-sm font-medium text-slate-700">
                        {item.currentBid.toFixed(2)}€
                      </td>
                      <td className="px-4 py-3 text-center">
                        {item.recommendedBid != null ? (
                          <div>
                            <div className="text-sm font-semibold text-brand-600">
                              {item.recommendedBid.toFixed(2)}€
                            </div>
                            {delta && (
                              <div className={`text-xs mt-0.5 ${item.recommendedBid > item.currentBid ? 'text-emerald-600' : 'text-red-600'}`}>
                                {item.recommendedBid > item.currentBid ? '+' : ''}{delta}%
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getActionBadgeColor(item)}`}>
                          {getActionBadgeLabel(item)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => canSelect && handleToggleAction(item.entityKey)}
                          disabled={!canSelect}
                          className={`w-4 h-4 rounded ${canSelect ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Info message */}
          {suggestions.some((s) => !s.eligible) && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-2.5 text-xs text-blue-700">
              Les entités inéligibles sont désactivées car elles ne disposent pas de suffisamment de données ou sont en période d'observation.
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <Button
              variant="primary"
              disabled={selectedCount === 0}
              onClick={handleApplyActions}
            >
              Appliquer {selectedCount} action{selectedCount !== 1 ? 's' : ''}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* Review stage - no suggestions */}
      {stage === 'review' && suggestions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-sm text-slate-500 mb-4">Aucune suggestion disponible pour les entités sélectionnées.</p>
          <Button variant="secondary" onClick={onClose}>
            Fermer
          </Button>
        </div>
      )}

      {/* Executing state */}
      {stage === 'executing' && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mb-4" />
          <p className="text-sm text-slate-600">Exécution des actions...</p>
        </div>
      )}

      {/* Done state */}
      {stage === 'done' && executeResult && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="mb-4 text-4xl font-bold text-emerald-600">✓</div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-900 mb-2">Actions exécutées avec succès</p>
            <div className="space-y-1 text-xs text-slate-600">
              <p>
                <span className="font-medium text-slate-900">{executeResult.succeeded}</span> action{executeResult.succeeded !== 1 ? 's' : ''} réussie{executeResult.succeeded !== 1 ? 's' : ''}
              </p>
              {executeResult.failed > 0 && (
                <p>
                  <span className="font-medium text-red-600">{executeResult.failed}</span> action{executeResult.failed !== 1 ? 's' : ''} échouée{executeResult.failed !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-4">Fermeture automatique...</p>
        </div>
      )}
    </Modal>
  );
}
