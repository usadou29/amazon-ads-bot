'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { t } from '@/lib/i18n';
import {
  fetchActionSuggestion,
  executeDirectAction,
  type ActionSuggestionRequest,
} from '@/lib/api/client';
import { ENTITY_DIAGNOSIS_COLORS, EntityDiagnosisCode } from '@/lib/transforms/insights';

// ── Types ───────────────────────────────────────────

interface ActionModalProps {
  open: boolean;
  onClose: () => void;
  entityKey: string;
  entityType: 'keyword' | 'target';
  entityName: string;
  workspaceId: string;
  acosTarget: number;
  lifecyclePhase?: string;
  onActionExecuted?: () => void;
}

interface SuggestionData {
  entityKey: string;
  entityType: string;
  entityName: string;
  diagnosisCode: string;
  eligibility: string;
  metrics: {
    impressions: number;
    clicks: number;
    orders: number;
    spend: number;
    sales: number;
    acos: number | null;
    ctr: number | null;
    cvr: number | null;
    periodDays: number;
  };
  currentBid: number;
  bidCalculation: {
    eligibility: string;
    recommendedBid: number | null;
    currentBid: number;
    cpcTarget: number | null;
    kFactor: number | null;
    positioningFactor: number;
    positioningLabel: string;
    bidFloor: number;
    bidCeiling: number;
    guardsCapped: boolean;
    guardsReason?: string;
    explanation: string;
  };
  amazonBid?: {
    suggested: number;
    rangeMin: number;
    rangeMax: number;
  };
  availableActions: Array<{
    type: 'adjust_bid' | 'pause';
    enabled: boolean;
    reason?: string;
  }>;
}

// ── Component ───────────────────────────────────────

export function ActionModal({
  open,
  onClose,
  entityKey,
  entityType,
  entityName,
  workspaceId,
  acosTarget,
  lifecyclePhase,
  onActionExecuted,
}: ActionModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SuggestionData | null>(null);
  const [sliderValue, setSliderValue] = useState(0);
  const [executing, setExecuting] = useState<'bid' | 'pause' | 'simulate' | null>(null);
  const [confirmAction, setConfirmAction] = useState<'bid' | 'pause' | null>(null);
  const [dryRunResult, setDryRunResult] = useState<{ before: number; after: number } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchSuggestion = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDryRunResult(null);
    setSuccessMessage(null);
    try {
      const dto: ActionSuggestionRequest = {
        workspaceId,
        entityKey,
        entityType,
        acosTarget,
        lifecyclePhase,
      };
      const result = await fetchActionSuggestion(dto);
      setData(result);
      // Initialiser le slider au bid recommandé ou au bid actuel
      const initialBid = result.bidCalculation.recommendedBid ?? result.currentBid;
      setSliderValue(initialBid);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || t('actionModal.error'));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, entityKey, entityType, acosTarget, lifecyclePhase]);

  useEffect(() => {
    if (open) {
      fetchSuggestion();
    }
  }, [open, fetchSuggestion]);

  const handleSimulate = async () => {
    if (!data) return;
    setExecuting('simulate');
    try {
      const result = await executeDirectAction({
        workspaceId,
        entityKey,
        entityType,
        actionType: 'adjust_bid',
        newBid: sliderValue,
        dryRun: true,
      });
      if (result.success) {
        setDryRunResult({
          before: result.beforeValue?.bid ?? data.currentBid,
          after: result.afterValue?.bid ?? sliderValue,
        });
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message);
    } finally {
      setExecuting(null);
    }
  };

  const handleApplyBid = async () => {
    if (!data) return;
    setExecuting('bid');
    try {
      const result = await executeDirectAction({
        workspaceId,
        entityKey,
        entityType,
        actionType: 'adjust_bid',
        newBid: sliderValue,
        rationale: data.bidCalculation.explanation,
      });
      if (result.success) {
        setSuccessMessage(t('actionModal.success'));
        setTimeout(() => {
          onActionExecuted?.();
          onClose();
        }, 1500);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message);
    } finally {
      setExecuting(null);
      setConfirmAction(null);
    }
  };

  const handlePause = async () => {
    if (!data) return;
    setExecuting('pause');
    try {
      const result = await executeDirectAction({
        workspaceId,
        entityKey,
        entityType,
        actionType: 'pause',
        rationale: 'Mis en pause depuis le modal Action',
      });
      if (result.success) {
        setSuccessMessage(t('actionModal.success'));
        setTimeout(() => {
          onActionExecuted?.();
          onClose();
        }, 1500);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message);
    } finally {
      setExecuting(null);
      setConfirmAction(null);
    }
  };

  const canAdjustBid = data?.availableActions.find((a) => a.type === 'adjust_bid');
  const canPause = data?.availableActions.find((a) => a.type === 'pause');

  const diagColors = data
    ? ENTITY_DIAGNOSIS_COLORS[data.diagnosisCode as EntityDiagnosisCode] || {
        bg: 'bg-slate-50',
        text: 'text-slate-600',
        border: 'border-slate-200',
      }
    : { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' };

  return (
    <Modal open={open} onClose={onClose} title={t('actionModal.title', { entityName })} wide>
      {/* Success message */}
      {successMessage && (
        <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
          {successMessage}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-pulse text-sm text-slate-500">{t('actionModal.loading')}</div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="text-center py-8">
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <Button variant="secondary" size="sm" onClick={fetchSuggestion}>
            {t('actionModal.retry')}
          </Button>
        </div>
      )}

      {/* Main content */}
      {data && !loading && !successMessage && (
        <div className="space-y-4">
          {/* Diagnostic + Confiance */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{t('actionModal.diagnostic')} :</span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${diagColors.bg} ${diagColors.text} ${diagColors.border}`}
              >
                {data.diagnosisCode.replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          {/* Métriques */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1 text-xs font-medium text-slate-500">{t('actionModal.metrics')} ({data.metrics.periodDays}j)</div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
              <div>
                <span className="text-slate-400">Impr:</span>{' '}
                <span className="font-medium text-slate-700">{data.metrics.impressions.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-slate-400">Clics:</span>{' '}
                <span className="font-medium text-slate-700">{data.metrics.clicks}</span>
              </div>
              <div>
                <span className="text-slate-400">Ventes:</span>{' '}
                <span className="font-medium text-slate-700">{data.metrics.orders}</span>
              </div>
              <div>
                <span className="text-slate-400">ACoS:</span>{' '}
                <span className="font-medium text-slate-700">
                  {data.metrics.acos != null ? `${data.metrics.acos}%` : '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400">CTR:</span>{' '}
                <span className="font-medium text-slate-700">
                  {data.metrics.ctr != null ? `${data.metrics.ctr}%` : '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400">CVR:</span>{' '}
                <span className="font-medium text-slate-700">
                  {data.metrics.cvr != null ? `${data.metrics.cvr}%` : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Bid section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">{t('actionModal.currentBid')}</span>
              <span className="font-semibold text-slate-800">{data.currentBid.toFixed(2)}€</span>
            </div>

            {data.bidCalculation.recommendedBid != null && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{t('actionModal.recommendedBid')}</span>
                <span className="font-semibold text-brand-600">
                  {data.bidCalculation.recommendedBid.toFixed(2)}€
                </span>
              </div>
            )}

            {data.amazonBid && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{t('actionModal.amazonBid')}</span>
                <span className="font-medium text-amber-600">
                  {data.amazonBid.suggested.toFixed(2)}€{' '}
                  <span className="text-slate-400">
                    [{data.amazonBid.rangeMin.toFixed(2)} – {data.amazonBid.rangeMax.toFixed(2)}]
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* Eligibility message */}
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-2.5 text-xs text-blue-700">
            {t(`actionModal.eligibility.${data.eligibility}`, {
              clicks: String(data.metrics.clicks),
              orders: String(data.metrics.orders),
            })}
          </div>

          {/* Explanation */}
          {data.bidCalculation.explanation && (
            <div className="text-xs text-slate-600 italic">
              {data.bidCalculation.explanation}
            </div>
          )}

          {/* Slider (only if adjust_bid is enabled) */}
          {canAdjustBid?.enabled && data.bidCalculation.recommendedBid != null && (
            <div className="space-y-2 pt-1">
              <label className="block text-xs font-medium text-slate-600">
                {t('actionModal.sliderLabel')}
              </label>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-400">{data.bidCalculation.bidFloor.toFixed(2)}€</span>
                <input
                  type="range"
                  min={data.bidCalculation.bidFloor}
                  max={data.bidCalculation.bidCeiling}
                  step={0.01}
                  value={sliderValue}
                  onChange={(e) => setSliderValue(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 rounded-full appearance-none bg-slate-200 accent-brand-600"
                />
                <span className="text-[10px] text-slate-400">{data.bidCalculation.bidCeiling.toFixed(2)}€</span>
              </div>
              <div className="text-center text-sm font-semibold text-brand-700">
                → {sliderValue.toFixed(2)}€
                {sliderValue !== data.currentBid && (
                  <span className={`ml-1.5 text-xs font-normal ${sliderValue > data.currentBid ? 'text-emerald-600' : 'text-red-500'}`}>
                    ({sliderValue > data.currentBid ? '+' : ''}
                    {(((sliderValue - data.currentBid) / data.currentBid) * 100).toFixed(1)}%)
                  </span>
                )}
              </div>

              {/* Guards warning */}
              {data.bidCalculation.guardsCapped && data.bidCalculation.guardsReason && (
                <div className="text-[10px] text-amber-600">
                  {data.bidCalculation.guardsReason}
                </div>
              )}
            </div>
          )}

          {/* Disabled action messages */}
          {canAdjustBid && !canAdjustBid.enabled && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-500">
              {canAdjustBid.reason}
            </div>
          )}

          {/* Dry-run result */}
          {dryRunResult && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 text-xs text-indigo-700">
              {t('actionModal.dryRunResult', {
                currentBid: dryRunResult.before.toFixed(2),
                newBid: dryRunResult.after.toFixed(2),
              })}
            </div>
          )}

          {/* Confirmation dialog */}
          {confirmAction && (
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
              <p className="text-sm text-amber-800 mb-3">
                {confirmAction === 'bid'
                  ? t('actionModal.confirmApply', {
                      currentBid: data.currentBid.toFixed(2),
                      newBid: sliderValue.toFixed(2),
                    })
                  : t('actionModal.confirmPause', { entityName })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={executing !== null}
                  onClick={confirmAction === 'bid' ? handleApplyBid : handlePause}
                >
                  Confirmer
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirmAction(null)}>
                  {t('actionModal.cancel')}
                </Button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {!confirmAction && (
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              {canAdjustBid?.enabled && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={executing === 'simulate'}
                    onClick={handleSimulate}
                  >
                    {t('actionModal.simulate')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={executing === 'bid'}
                    onClick={() => setConfirmAction('bid')}
                  >
                    {t('actionModal.apply')}
                  </Button>
                </>
              )}
              {canPause?.enabled && (
                <Button
                  variant="danger"
                  size="sm"
                  loading={executing === 'pause'}
                  onClick={() => setConfirmAction('pause')}
                >
                  {t('actionModal.pause')}
                </Button>
              )}
              {canPause && !canPause.enabled && (
                <span className="text-[10px] text-slate-400">{canPause.reason}</span>
              )}
            </div>
          )}

          {/* Guards info */}
          <div className="text-[10px] text-slate-400 pt-1">
            {t('actionModal.guards', {
              maxIncrease: '20',
              minBid: '0.10',
              maxBid: '2.00',
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
