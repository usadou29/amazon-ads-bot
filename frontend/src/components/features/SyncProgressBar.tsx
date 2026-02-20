'use client';
import React from 'react';
import { useSyncContext } from '@/lib/contexts/SyncContext';

function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  const min = Math.ceil(seconds / 60);
  return `~${min} min`;
}

export function SyncProgressBar() {
  const { syncing, progress, success } = useSyncContext();

  // Rien à afficher
  if (!syncing && !success) return null;

  const barColor = success ? 'bg-emerald-500' : 'bg-brand-500';
  const bgColor = success ? 'bg-emerald-50' : 'bg-brand-50';
  const textColor = success ? 'text-emerald-700' : 'text-brand-700';

  // Estimation du temps restant (approximatif)
  const remaining = syncing && progress > 0 && progress < 95
    ? Math.round(((100 - progress) / progress) * (progress / 100) * 240) // rough estimate
    : 0;

  return (
    <div className={`w-full ${bgColor} border-b border-slate-200 transition-all duration-500`}>
      {/* Barre de progression */}
      <div className="h-1 w-full bg-slate-200/50">
        <div
          className={`h-full ${barColor} transition-all duration-1000 ease-out`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Texte de statut */}
      <div className="max-w-5xl mx-auto px-4 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {syncing && (
            <svg
              className="w-3.5 h-3.5 animate-spin text-brand-600"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {success && (
            <span className="text-emerald-600 text-sm">✓</span>
          )}
          <span className={`text-xs font-medium ${textColor}`}>
            {success
              ? 'Synchronisation terminée — données mises à jour'
              : `Synchronisation en cours... ${progress}%`}
          </span>
        </div>
        {syncing && remaining > 0 && (
          <span className="text-xs text-slate-400">
            {formatTimeRemaining(remaining)}
          </span>
        )}
      </div>
    </div>
  );
}
