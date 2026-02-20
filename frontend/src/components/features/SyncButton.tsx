'use client';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { triggerSync, fetchSyncStatus } from '@/lib/api/client';
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

const POLL_INTERVAL = 5000;

export function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncingRef = useRef(false); // Keep a ref in sync with state to avoid stale closures

  // Keep ref in sync
  useEffect(() => {
    syncingRef.current = syncing;
  }, [syncing]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const data = await fetchSyncStatus();
      if (data.lastSyncAt) setLastSync(data.lastSyncAt);

      if (data.syncInProgress) {
        setSyncing(true);
      } else {
        // Sync finished (or was never running)
        if (syncingRef.current) {
          // Was syncing, now done → show success + reload
          setSyncing(false);
          setSuccess(true);
          stopPolling();
          setTimeout(() => window.location.reload(), 1500);
        } else {
          // Wasn't syncing — just stop polling
          stopPolling();
        }
      }
    } catch {
      // Ignore polling errors
    }
  }, [stopPolling]);

  // Initial status check
  useEffect(() => {
    fetchSyncStatus()
      .then((data: any) => {
        if (data.lastSyncAt) setLastSync(data.lastSyncAt);
        if (data.syncInProgress) {
          setSyncing(true);
          pollRef.current = setInterval(checkStatus, POLL_INTERVAL);
        }
      })
      .catch(() => {});

    return () => stopPolling();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setSuccess(false);

    try {
      await triggerSync();

      // Start polling for completion
      stopPolling();
      pollRef.current = setInterval(checkStatus, POLL_INTERVAL);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Erreur de synchronisation';
      setError(msg);
      setSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={handleSync}
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
      {lastSync && !error && !success && (
        <span className="text-xs text-slate-400">{formatRelativeTime(lastSync)}</span>
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
