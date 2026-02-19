'use client';
import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { fetchAvailableCampaigns, linkCampaignToBook } from '@/lib/api/client';
import { t } from '@/lib/i18n';

interface LinkCampaignsModalProps {
  open: boolean;
  onClose: () => void;
  bookId: string;
  bookTitle: string;
  onLinked?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  sponsoredProducts: 'SP',
  sponsoredBrands: 'SB',
  sponsoredDisplay: 'SD',
};

const STATE_COLORS: Record<string, string> = {
  enabled: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  archived: 'bg-slate-100 text-slate-500',
};

export function LinkCampaignsModal({ open, onClose, bookId, bookTitle, onLinked }: LinkCampaignsModalProps) {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setPrimaryId(null);
    setSuccessCount(0);
    fetchAvailableCampaigns(bookId)
      .then((data) => setCampaigns(Array.isArray(data) ? data : data?.campaigns || []))
      .catch((e) => setError(e.response?.data?.message || e.message))
      .finally(() => setLoading(false));
  }, [open, bookId]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (primaryId === id) setPrimaryId(null);
      } else {
        next.add(id);
        if (!primaryId) setPrimaryId(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === campaigns.length) {
      setSelected(new Set());
      setPrimaryId(null);
    } else {
      setSelected(new Set(campaigns.map((c) => c.id)));
      if (!primaryId && campaigns.length > 0) setPrimaryId(campaigns[0].id);
    }
  };

  const handleLink = async () => {
    if (selected.size === 0) return;
    setLinking(true);
    setError(null);
    let count = 0;
    const errors: string[] = [];

    for (const campaignId of Array.from(selected)) {
      try {
        await linkCampaignToBook(bookId, campaignId, campaignId === primaryId);
        count++;
      } catch (err: any) {
        const name = campaigns.find((c) => c.id === campaignId)?.name || campaignId;
        errors.push(`${name}: ${err.response?.data?.message || err.message}`);
      }
    }

    setLinking(false);
    setSuccessCount(count);

    if (errors.length > 0) {
      setError(`${count} associée(s) avec succès. Erreurs: ${errors.join('; ')}`);
    }

    if (count > 0 && onLinked) {
      onLinked();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('link_campaigns.title')} wide>
      {successCount > 0 && !error ? (
        <div className="py-8 text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-slate-900">
            {successCount} campagne(s) associée(s) à « {bookTitle} »
          </p>
          <p className="text-sm text-slate-500">
            {t('link_campaigns.success_hint')}
          </p>
          <Button variant="primary" onClick={onClose}>
            {t('common.back')}
          </Button>
        </div>
      ) : loading ? (
        <div className="py-8 text-center text-sm text-slate-500">{t('common.loading')}</div>
      ) : campaigns.length === 0 ? (
        <div className="py-8 text-center space-y-2">
          <p className="text-slate-500 text-sm">{t('link_campaigns.no_available')}</p>
          <p className="text-xs text-slate-400">{t('link_campaigns.no_available_hint')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              {t('link_campaigns.description', { book: bookTitle })}
            </p>
            <button
              onClick={selectAll}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              {selected.size === campaigns.length ? t('link_campaigns.deselect_all') : t('link_campaigns.select_all')}
            </button>
          </div>

          <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-2 w-8"></th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-slate-500 uppercase">{t('campaigns.name')}</th>
                  <th className="text-center py-2 px-2 text-xs font-medium text-slate-500 uppercase">{t('campaigns.type')}</th>
                  <th className="text-center py-2 px-2 text-xs font-medium text-slate-500 uppercase">{t('campaigns.state')}</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-slate-500 uppercase">{t('campaigns.daily_budget')}</th>
                  <th className="text-center py-2 px-2 text-xs font-medium text-slate-500 uppercase w-20">{t('link_campaigns.primary')}</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c: any) => {
                  const isSelected = selected.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      className={`border-b border-slate-100 cursor-pointer transition-colors ${
                        isSelected ? 'bg-brand-50' : 'hover:bg-slate-50'
                      }`}
                      onClick={() => toggleSelect(c.id)}
                    >
                      <td className="py-2 px-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(c.id)}
                          className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="py-2 px-2 font-medium text-slate-900 max-w-[220px] truncate">
                        {c.name}
                      </td>
                      <td className="py-2 px-2 text-center text-slate-600 text-xs">
                        {TYPE_LABELS[c.campaignType] || c.campaignType}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATE_COLORS[c.state] || 'bg-slate-100 text-slate-600'}`}>
                          {c.state}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-slate-700">
                        {c.dailyBudget ? `${Number(c.dailyBudget).toFixed(2)} €` : '—'}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {isSelected && (
                          <input
                            type="radio"
                            name="primary-campaign"
                            checked={primaryId === c.id}
                            onChange={() => setPrimaryId(c.id)}
                            className="text-accent-500 focus:ring-accent-500"
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              {selected.size} campagne(s) sélectionnée(s)
              {primaryId && selected.has(primaryId) && ' · 1 principale'}
            </p>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
              <Button
                variant="accent"
                onClick={handleLink}
                loading={linking}
                disabled={selected.size === 0}
              >
                {t('link_campaigns.submit', { count: selected.size })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
