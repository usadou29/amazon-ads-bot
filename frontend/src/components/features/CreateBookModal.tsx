'use client';
import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { createBook } from '@/lib/api/client';
import { t } from '@/lib/i18n';

const MARKETPLACES = [
  { value: 'FR', label: 'France (FR)' },
  { value: 'DE', label: 'Allemagne (DE)' },
  { value: 'UK', label: 'Royaume-Uni (UK)' },
  { value: 'US', label: 'États-Unis (US)' },
  { value: 'ES', label: 'Espagne (ES)' },
  { value: 'IT', label: 'Italie (IT)' },
];

const ROYALTY_OPTIONS = [
  { value: 'unknown', label: 'Je ne sais pas (on estimera à 25%)', rate: null },
  { value: '35', label: '35% — Taux standard KDP', rate: 35 },
  { value: '70', label: '70% — Taux premium KDP', rate: 70 },
  { value: 'custom', label: 'Autre pourcentage...', rate: null },
];

interface CreateBookModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (book: { id: string; title: string }) => void;
}

export function CreateBookModal({ open, onClose, onSuccess }: CreateBookModalProps) {
  const [asin, setAsin] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [marketplace, setMarketplace] = useState('FR');
  const [royaltyOption, setRoyaltyOption] = useState('unknown');
  const [customRoyalty, setCustomRoyalty] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setAsin('');
    setTitle('');
    setAuthor('');
    setMarketplace('FR');
    setRoyaltyOption('unknown');
    setCustomRoyalty('');
    setError(null);
  };

  const getRoyaltyRate = (): number | undefined => {
    if (royaltyOption === 'unknown') return undefined; // backend will use default 25%
    if (royaltyOption === 'custom') {
      const val = parseFloat(customRoyalty);
      if (isNaN(val) || val < 1 || val > 100) return undefined;
      return val;
    }
    return Number(royaltyOption);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!asin.trim()) { setError('L\'ASIN est requis'); return; }

    if (royaltyOption === 'custom') {
      const val = parseFloat(customRoyalty);
      if (isNaN(val) || val < 1 || val > 100) {
        setError('La redevance doit être entre 1% et 100%');
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const result = await createBook({
        asin: asin.trim(),
        marketplace,
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        royaltyRate: getRoyaltyRate(),
      });
      const bookId = result?.id || result?.book?.id;
      const bookTitle = title.trim() || asin.trim();
      resetForm();
      onSuccess({ id: bookId, title: bookTitle });
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Erreur lors de la création';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const inputClass = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500';

  return (
    <Modal open={open} onClose={handleClose} title={t('book_creation.title')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('book_creation.asin')} *</label>
          <input
            type="text"
            value={asin}
            onChange={(e) => setAsin(e.target.value)}
            placeholder="B0XXXXXXXX"
            className={inputClass}
            maxLength={10}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('book_creation.title_field')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Mon livre"
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('book_creation.author_field')}</label>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Nom de plume"
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('book_creation.marketplace')} *</label>
          <select
            value={marketplace}
            onChange={(e) => setMarketplace(e.target.value)}
            className={`${inputClass} bg-white`}
          >
            {MARKETPLACES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* ── Redevance (royalty rate) ── */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Ta redevance KDP
          </label>
          <p className="text-xs text-slate-500 mb-2">
            C'est le pourcentage que tu touches sur chaque vente. Ça nous permet de calculer ce que tu gagnes vraiment.
          </p>
          <select
            value={royaltyOption}
            onChange={(e) => setRoyaltyOption(e.target.value)}
            className={`${inputClass} bg-white`}
          >
            {ROYALTY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {royaltyOption === 'custom' && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                value={customRoyalty}
                onChange={(e) => setCustomRoyalty(e.target.value)}
                placeholder="ex: 45"
                min={1}
                max={100}
                className={`${inputClass} w-24`}
              />
              <span className="text-sm text-slate-500">%</span>
            </div>
          )}

          {royaltyOption === 'unknown' && (
            <p className="text-xs text-amber-600 mt-1">
              On estimera tes gains à 25% des ventes Amazon. Tu pourras ajuster plus tard.
            </p>
          )}
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={handleClose}>{t('book_creation.cancel')}</Button>
          <Button type="submit" variant="accent" loading={loading} className="flex-1">{t('book_creation.submit')}</Button>
        </div>
      </form>
    </Modal>
  );
}
