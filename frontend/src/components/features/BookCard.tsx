'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { StatusResult } from '@/lib/transforms/status';
import { deleteBook } from '@/lib/api/client';

export interface BookCardData {
  id: string;
  title: string;
  asin: string;
  marketplace: string;
  author?: string;
  status: StatusResult;
  profit: number;
  profitFormatted: string;
  revenue: number;
  revenueFormatted: string;
  sales: number;
  salesFormatted: string;
  spend: number;
  spendFormatted: string;
  orders: number;
  pendingRecommendations: number;
  royaltyRate: number;
  isEstimated: boolean;
}

const statusBg: Record<string, string> = {
  success: 'border-l-emerald-500 bg-emerald-50/50',
  warning: 'border-l-amber-400 bg-amber-50/50',
  danger: 'border-l-red-500 bg-red-50/50',
};

const profitColor = (profit: number) =>
  profit > 0 ? 'text-emerald-700' : profit < 0 ? 'text-red-600' : 'text-slate-600';

interface BookCardProps {
  book: BookCardData;
  onDeleted?: (bookId: string) => void;
}

export function BookCard({ book, onDeleted }: BookCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(true);
  };

  const handleConfirmDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    try {
      await deleteBook(book.id);
      onDeleted?.(book.id);
    } catch (err) {
      console.error('Erreur suppression livre:', err);
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(false);
  };

  return (
    <Link href={`/books/${book.id}`} className="block">
      <div
        className={`rounded-xl border-l-4 border border-slate-200 p-4 transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer relative group ${statusBg[book.status.type] || ''}`}
      >
        {/* ── Bandeau de confirmation de suppression ── */}
        {confirmDelete && (
          <div
            className="absolute inset-0 z-10 bg-white/95 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center gap-3 p-4"
            onClick={(e) => e.preventDefault()}
          >
            <p className="text-sm font-medium text-slate-900 text-center">
              Supprimer « {book.title || book.asin} » ?
            </p>
            <p className="text-xs text-slate-500 text-center">
              Les campagnes associées ne seront pas supprimées.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCancelDelete}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-lg transition-colors"
              >
                {deleting ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        )}

        {/* ── Bouton supprimer (visible au hover) ── */}
        <button
          onClick={handleDeleteClick}
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-300 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center text-sm z-[5]"
          title="Supprimer ce livre"
        >
          &times;
        </button>

        {/* ── Header: titre + statut ── */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-slate-900 truncate leading-tight">
              {book.title || book.asin}
            </h3>
            {book.author && (
              <p className="text-xs text-slate-400 mt-0.5">{book.author}</p>
            )}
          </div>
          {/* Pastille de couverture placeholder */}
          <div className="w-10 h-14 rounded bg-slate-200 flex-shrink-0 flex items-center justify-center text-lg">
            {book.status.emoji}
          </div>
        </div>

        {/* ── Profit — LA métrique principale ── */}
        <div className="mb-3">
          <p className={`text-2xl font-bold ${profitColor(book.profit)}`}>
            {book.profitFormatted}
          </p>
          <p className="text-xs text-slate-500">
            gains réels ce mois-ci{book.isEstimated ? ' (estimé)' : ''}
          </p>
        </div>

        {/* ── Résumé en langage naturel ── */}
        <p className="text-sm text-slate-600 mb-3 leading-relaxed">
          {book.status.description}
        </p>

        {/* ── Mini KPIs ── */}
        <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
          <span>{book.revenueFormatted} de redevances ({book.royaltyRate}%)</span>
          <span className="text-slate-300">|</span>
          <span>{book.spendFormatted} dépensé</span>
          {book.orders > 0 && (
            <>
              <span className="text-slate-300">|</span>
              <span>{book.orders} commande{book.orders > 1 ? 's' : ''}</span>
            </>
          )}
        </div>

        {/* ── Conseils en attente ── */}
        <div className="flex items-center justify-between">
          {book.pendingRecommendations > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
              {book.pendingRecommendations} conseil{book.pendingRecommendations > 1 ? 's' : ''}
            </span>
          ) : (
            <span />
          )}
          <span className="text-xs font-medium text-brand-600">
            Voir les détails →
          </span>
        </div>
      </div>
    </Link>
  );
}
