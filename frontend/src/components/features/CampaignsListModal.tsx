'use client';
import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { fetchCampaigns } from '@/lib/api/client';
import { t } from '@/lib/i18n';

interface CampaignsListModalProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  sponsoredProducts: 'Sponsored Products',
  sponsoredBrands: 'Sponsored Brands',
  sponsoredDisplay: 'Sponsored Display',
};

const STATE_COLORS: Record<string, string> = {
  enabled: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  archived: 'bg-slate-100 text-slate-500',
};

export function CampaignsListModal({ open, onClose }: CampaignsListModalProps) {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchCampaigns()
      .then((data) => setCampaigns(Array.isArray(data) ? data : []))
      .catch((e) => setError(e.response?.data?.message || e.message))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('campaigns.list_title')} wide>
      {loading ? (
        <div className="py-8 text-center text-sm text-slate-500">{t('common.loading')}</div>
      ) : error ? (
        <div className="py-8 text-center">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-slate-500 text-sm">{t('campaigns.no_campaigns')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 mb-3">
            {campaigns.length} campagne(s) trouvée(s). Créez un livre puis associez-y vos campagnes pour suivre leurs performances.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-2 text-xs font-medium text-slate-500 uppercase">{t('campaigns.name')}</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-slate-500 uppercase">{t('campaigns.type')}</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-slate-500 uppercase">{t('campaigns.state')}</th>
                  <th className="text-right py-2 px-2 text-xs font-medium text-slate-500 uppercase">{t('campaigns.daily_budget')}</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-slate-500 uppercase">{t('campaigns.marketplace')}</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c: any) => (
                  <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-2 font-medium text-slate-900 max-w-[200px] truncate">{c.name}</td>
                    <td className="py-2 px-2 text-slate-600">{TYPE_LABELS[c.campaignType] || c.campaignType}</td>
                    <td className="py-2 px-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATE_COLORS[c.state] || 'bg-slate-100 text-slate-600'}`}>
                        {c.state}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right text-slate-700">
                      {c.dailyBudget ? `${Number(c.dailyBudget).toFixed(2)} €` : '—'}
                    </td>
                    <td className="py-2 px-2 text-slate-600">{c.marketplace}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
