'use client';
import React from 'react';
import Link from 'next/link';
import { StatusResult } from '@/lib/transforms/status';

export interface BookCardData {
  id: string;
  title: string;
  asin: string;
  marketplace: string;
  author?: string;
  status: StatusResult;
  profit: number;
  profitFormatted: string;
  sales: number;
  salesFormatted: string;
  spend: number;
  spendFormatted: string;
  orders: number;
  pendingRecommendations: number;
}

const statusBg: Record<string, string> = {
  success: 'border-l-emerald-500 bg-emerald-50/50',
  warning: 'border-l-amber-400 bg-amber-50/50',
  danger: 'border-l-red-500 bg-red-50/50',
};

const profitColor = (profit: number) =>
  profit > 0 ? 'text-emerald-700' : profit < 0 ? 'text-red-600' : 'text-slate-600';

export function BookCard({ book }: { book: BookCardData }) {
  return (
    <Link href={`/books/${book.id}`} className="block">
      <div
        className={`rounded-xl border-l-4 border border-slate-200 p-4 transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer ${statusBg[book.status.type] || ''}`}
      >
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
          <p className="text-xs text-slate-500">profit pub ce mois-ci</p>
        </div>

        {/* ── Résumé en langage naturel ── */}
        <p className="text-sm text-slate-600 mb-3 leading-relaxed">
          {book.status.description}
        </p>

        {/* ── Mini KPIs ── */}
        <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
          <span>{book.salesFormatted} de ventes</span>
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
