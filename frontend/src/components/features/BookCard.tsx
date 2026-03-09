'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { StatusResult } from '@/lib/transforms/status';
import { deleteBook } from '@/lib/api/client';
import { toast } from '@/lib/toast';
import { AnimatedNumber } from '@/lib/motion';

export interface BookCardData {
  id: string;
  title: string;
  asin: string;
  marketplace: string;
  author?: string;
  coverImageUrl?: string | null;
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

const statusConfig = {
  success: {
    bg: 'border-l-emerald-500 bg-emerald-500/10',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    shadow: 'shadow-emerald-500/10',
  },
  warning: {
    bg: 'border-l-amber-400 bg-amber-500/10',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    shadow: 'shadow-amber-500/10',
  },
  danger: {
    bg: 'border-l-red-500 bg-red-500/10',
    badge: 'bg-red-500/20 text-red-300 border-red-500/30',
    shadow: 'shadow-red-500/10',
  },
};

const profitColor = (profit: number) =>
  profit > 0 ? 'text-emerald-400' : profit < 0 ? 'text-red-400' : 'text-slate-400';

interface BookCardProps {
  book: BookCardData;
  onDeleted?: (bookId: string) => void;
  index?: number;
}

export function BookCard({ book, onDeleted, index = 0 }: BookCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

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
      toast.success('Livre supprimé', `"${book.title || book.asin}" a été supprimé`);
      onDeleted?.(book.id);
    } catch (err) {
      console.error('Erreur suppression livre:', err);
      toast.error('Erreur', 'Impossible de supprimer le livre');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDelete(false);
  };

  const status = statusConfig[book.status.type] || statusConfig.warning;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ 
        duration: 0.4, 
        delay: index * 0.1,
        ease: [0.25, 0.1, 0.25, 1]
      }}
      whileHover={{ 
        y: -4,
        transition: { type: 'spring', stiffness: 400, damping: 25 }
      }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      className="relative"
    >
      <Link href={`/books/${book.id}`} className="block">
        <motion.div
          className={`rounded-xl border-l-4 border border-white/10 p-4 cursor-pointer relative overflow-hidden backdrop-blur-sm ${status.bg}`}
          animate={{
            boxShadow: isHovered 
              ? '0 12px 24px -8px rgba(0, 0, 0, 0.15), 0 4px 8px -4px rgba(0, 0, 0, 0.1)' 
              : '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.08)',
          }}
          transition={{ duration: 0.2 }}
        >
          {/* ── Bandeau de confirmation de suppression ── */}
          <AnimatePresence>
            {confirmDelete && (
              <motion.div
                initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                animate={{ opacity: 1, backdropFilter: 'blur(4px)' }}
                exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 z-10 bg-slate-900/95 flex flex-col items-center justify-center gap-3 p-4"
                onClick={(e) => e.preventDefault()}
              >
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="text-center"
                >
                  <p className="text-sm font-medium text-white text-center mb-1">
                    Supprimer « {book.title || book.asin} » ?
                  </p>
                  <p className="text-xs text-slate-400 text-center mb-4">
                    Les campagnes associées ne seront pas supprimées.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={handleCancelDelete}
                      className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={handleConfirmDelete}
                      disabled={deleting}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2"
                    >
                      {deleting && (
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                          className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                        />
                      )}
                      {deleting ? 'Suppression...' : 'Supprimer'}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Bouton supprimer (visible au hover avec animation) ── */}
          <AnimatePresence>
            {isHovered && !confirmDelete && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15 }}
                onClick={handleDeleteClick}
                className="absolute top-3 right-3 w-7 h-7 rounded-full bg-slate-800 border border-white/10 text-slate-400 hover:text-red-400 hover:border-red-400/50 transition-colors flex items-center justify-center text-sm z-[5]"
                title="Supprimer ce livre"
              >
                ×
              </motion.button>
            )}
          </AnimatePresence>

          {/* ── Header: titre + statut ── */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <motion.h3 
                className="text-base font-semibold text-white truncate leading-tight"
                layoutId={`title-${book.id}`}
              >
                {book.title || book.asin}
              </motion.h3>
              {book.author && (
                <p className="text-xs text-slate-400 mt-0.5">{book.author}</p>
              )}
            </div>
            {/* Couverture du livre avec animation */}
            <motion.div
              whileHover={{ scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              {book.coverImageUrl ? (
                <img
                  src={book.coverImageUrl}
                  alt={book.title || book.asin}
                  className="w-28 h-40 rounded-lg object-cover flex-shrink-0 shadow-md"
                />
              ) : (
                <div className="w-28 h-40 rounded-lg bg-slate-700 flex-shrink-0 flex items-center justify-center text-3xl shadow-md">
                  {book.status.emoji}
                </div>
              )}
            </motion.div>
          </div>

          {/* ── Profit — LA métrique principale avec animation ── */}
          <div className="mb-3">
            <motion.p 
              className={`text-2xl font-bold ${profitColor(book.profit)}`}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 + 0.2, type: 'spring' }}
            >
              <AnimatedNumber 
                value={book.profit} 
                prefix={book.profit >= 0 ? '+' : ''} 
                suffix="€" 
                decimals={0}
              />
            </motion.p>
            <p className="text-xs text-slate-400">
              gains réels ce mois-ci{book.isEstimated ? ' (estimé)' : ''}
            </p>
          </div>

          {/* ── Résumé en langage naturel ── */}
          <p className="text-sm text-slate-300 mb-3 leading-relaxed">
            {book.status.description}
          </p>

          {/* ── Mini KPIs animés ── */}
          <motion.div 
            className="flex items-center gap-4 text-xs text-slate-400 mb-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: index * 0.1 + 0.3 }}
          >
            <span>{book.revenueFormatted} de redevances ({book.royaltyRate}%)</span>
            <span className="text-slate-300">|</span>
            <span>{book.spendFormatted} dépensé</span>
            {book.orders > 0 && (
              <>
                <span className="text-slate-300">|</span>
                <span>{book.orders} commande{book.orders > 1 ? 's' : ''}</span>
              </>
            )}
          </motion.div>

          {/* ── Conseils en attente avec animation ── */}
          <div className="flex items-center justify-between">
            {book.pendingRecommendations > 0 ? (
              <motion.span 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 bg-amber-500/20 border border-amber-500/30 px-2 py-1 rounded-full"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                {book.pendingRecommendations} conseil{book.pendingRecommendations > 1 ? 's' : ''}
              </motion.span>
            ) : (
              <span />
            )}
            <motion.span 
              className="text-xs font-medium text-indigo-400 flex items-center gap-1"
              animate={{ x: isHovered ? 4 : 0 }}
              transition={{ type: 'spring', stiffness: 400 }}
            >
              Voir les détails 
              <motion.span
                animate={{ x: isHovered ? 2 : 0 }}
                transition={{ type: 'spring', stiffness: 400 }}
              >
                →
              </motion.span>
            </motion.span>
          </div>
        </motion.div>
      </Link>
    </motion.div>
  );
}
