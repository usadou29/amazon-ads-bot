'use client';
import React from 'react';
import { Button } from '@/components/ui/Button';
import { useSyncContext } from '@/lib/contexts/SyncContext';
import { t } from '@/lib/i18n';

function formatRelativeTime(date: string | Date | null): string {
  if (!date) return 'Jamais synchronisé';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return "À l'instant";
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  if (diffH < 24) return `Il y a ${diffH}h`;
  if (diffD < 7) return `Il y a ${diffD}j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function SyncButton() {
  const { syncing, lastSyncAt, triggerSync, success, error } = useSyncContext();

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={triggerSync}
        disabled={syncing}
      >
        <svg
          className={`w-4 h-4 mr-1.5 ${syncing ? 'animate-spin' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {syncing ? t('sync.syncing') : t('sync.button')}
      </Button>
      {lastSyncAt && !error && !success && (
        <span className="text-xs text-slate-400">{formatRelativeTime(lastSyncAt)}</span>
      )}
      {success && (
        <span className="text-xs text-emerald-600 font-medium">{t('sync.success')}</span>
      )}
      {error && (
        <span className="text-xs text-red-500">{error}</span>
      )}
    </div>
  );
}
