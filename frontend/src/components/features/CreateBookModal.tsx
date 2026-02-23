'use client';
import React, { useState, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { createBook } from '@/lib/api/client';
import { RoyaltyEditor, RoyaltyValues } from './RoyaltyEditor';
import { t } from '@/lib/i18n';

const MARKETPLACES = [
  { value: 'FR', label: 'France (FR)' },
  { value: 'DE', label: 'Allemagne (DE)' },
  { value: 'UK', label: 'Royaume-Uni (UK)' },
  { value: 'US', label: 'États-Unis (US)' },
  { value: 'ES', label: 'Espagne (ES)' },
  { value: 'IT', label: 'Italie (IT)' },
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
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [publicationDate, setPublicationDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const royaltyRef = useRef<RoyaltyValues>({
    royaltyRate: null,
    salePrice: null,
    royaltyPerUnit: null,
  });

  const resetForm = () => {
    setAsin('');
    setTitle('');
    setAuthor('');
    setMarketplace('FR');
    setCoverImageUrl('');
    setPublicationDate('');
    setError(null);
    royaltyRef.current = { royaltyRate: null, salePrice: null, royaltyPerUnit: null };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!asin.trim()) { setError('L\'ASIN est requis'); return; }

    setLoading(true);
    setError(null);

    try {
      const rv = royaltyRef.current;
      const result = await createBook({
        asin: asin.trim(),
        marketplace,
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        coverImageUrl: coverImageUrl.trim() || undefined,
        publicationDate: publicationDate || undefined,
        royaltyRate: rv.royaltyRate ?? undefined,
        salePrice: rv.salePrice ?? undefined,
        royaltyPerUnit: rv.royaltyPerUnit ?? undefined,
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
          <label className="block text-sm font-medium text-slate-700 mb-1">Image de couverture</label>
          <div className="flex items-center gap-3">
            <input
              type="url"
              value={coverImageUrl}
              onChange={(e) => setCoverImageUrl(e.target.value)}
              placeholder="https://m.media-amazon.com/images/I/..."
              className={`${inputClass} flex-1`}
            />
            {coverImageUrl.trim() && (
              <img
                src={coverImageUrl.trim()}
                alt="Aperçu couverture"
                className="w-40 h-56 rounded-lg object-cover border border-slate-200 flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                onLoad={(e) => { (e.target as HTMLImageElement).style.display = 'block'; }}
              />
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            URL de l'image Amazon (clic droit sur la couverture Amazon → Copier l'adresse de l'image)
          </p>
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

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Date de publication</label>
          <input
            type="date"
            value={publicationDate}
            onChange={(e) => setPublicationDate(e.target.value)}
            className={inputClass}
          />
          <p className="text-xs text-slate-400 mt-1">
            Permet de détecter automatiquement la phase du livre (lancement, croissance, croisière)
          </p>
        </div>

        {/* ── Redevance ── */}
        <RoyaltyEditor
          onChange={(values) => { royaltyRef.current = values; }}
          compact
        />

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
