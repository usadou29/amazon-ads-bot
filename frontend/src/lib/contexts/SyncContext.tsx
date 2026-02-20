'use client';
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { triggerSync as apiTriggerSync, fetchSyncStatus } from '@/lib/api/client';

const DEFAULT_ESTIMATED_DURATION = 240; // 4 minutes par défaut
const POLL_INTERVAL = 5000; // 5 secondes
const PROGRESS_TICK_INTERVAL = 1000; // Mise à jour visuelle chaque seconde

interface SyncContextValue {
  /** Synchro en cours */
  syncing: boolean;
  /** Progression estimée 0-100 */
  progress: number;
  /** Date de la dernière synchro */
  lastSyncAt: string | null;
  /** Erreur éventuelle */
  error: string | null;
  /** Synchro terminée avec succès (true pendant 3s) */
  success: boolean;
  /** Lancer une synchro */
  triggerSync: () => Promise<void>;
  /** Compteur de synchros terminées (pour déclencher des refetch dans les pages) */
  syncCompletedCount: number;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSyncContext(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    throw new Error('useSyncContext must be used within a SyncProvider');
  }
  return ctx;
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [syncCompletedCount, setSyncCompletedCount] = useState(0);

  // Refs pour éviter les closures stales
  const syncingRef = useRef(false);
  const estimatedDurationRef = useRef(DEFAULT_ESTIMATED_DURATION);
  const syncStartedAtRef = useRef<Date | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync ref avec state
  useEffect(() => { syncingRef.current = syncing; }, [syncing]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  // Tick de progression : met à jour le % estimé chaque seconde
  const startProgressTick = useCallback(() => {
    stopTick();
    tickRef.current = setInterval(() => {
      if (!syncStartedAtRef.current) return;
      const elapsed = (Date.now() - syncStartedAtRef.current.getTime()) / 1000;
      const estimated = estimatedDurationRef.current;
      // Progression asymptotique : monte vite au début, ralentit vers 95%
      const rawProgress = (elapsed / estimated) * 100;
      // Capé à 95% — le 100% ne vient qu'avec la confirmation backend
      const capped = Math.min(rawProgress, 95);
      setProgress(Math.round(capped));
    }, PROGRESS_TICK_INTERVAL);
  }, [stopTick]);

  const handleSyncComplete = useCallback(() => {
    setSyncing(false);
    setProgress(100);
    setSuccess(true);
    stopPolling();
    stopTick();
    setSyncCompletedCount((c) => c + 1);

    // Reset après 3s
    setTimeout(() => {
      setSuccess(false);
      setProgress(0);
    }, 3000);
  }, [stopPolling, stopTick]);

  const checkStatus = useCallback(async () => {
    try {
      const data = await fetchSyncStatus();

      if (data.lastSyncAt) setLastSyncAt(data.lastSyncAt);

      // Mémoriser la durée estimée
      if (data.lastSyncDurationSeconds && data.lastSyncDurationSeconds > 0) {
        estimatedDurationRef.current = data.lastSyncDurationSeconds;
      }

      if (data.syncInProgress) {
        if (!syncingRef.current) {
          // Synchro détectée (démarrée ailleurs, ex: cron)
          setSyncing(true);
          if (data.syncStartedAt) {
            syncStartedAtRef.current = new Date(data.syncStartedAt);
          } else {
            syncStartedAtRef.current = new Date();
          }
          startProgressTick();
        }
      } else {
        // Synchro terminée
        if (syncingRef.current) {
          handleSyncComplete();
        } else {
          // Pas de synchro et on n'était pas en train de sync → stop polling
          stopPolling();
        }
      }
    } catch {
      // Ignore les erreurs de polling
    }
  }, [handleSyncComplete, startProgressTick, stopPolling]);

  // Check initial au mount
  useEffect(() => {
    fetchSyncStatus()
      .then((data: any) => {
        if (data.lastSyncAt) setLastSyncAt(data.lastSyncAt);
        if (data.lastSyncDurationSeconds && data.lastSyncDurationSeconds > 0) {
          estimatedDurationRef.current = data.lastSyncDurationSeconds;
        }
        if (data.syncInProgress) {
          setSyncing(true);
          syncStartedAtRef.current = data.syncStartedAt ? new Date(data.syncStartedAt) : new Date();
          startProgressTick();
          pollRef.current = setInterval(checkStatus, POLL_INTERVAL);
        }
      })
      .catch(() => {});

    return () => { stopPolling(); stopTick(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerSync = useCallback(async () => {
    if (syncingRef.current) return;

    setSyncing(true);
    setError(null);
    setSuccess(false);
    setProgress(0);
    syncStartedAtRef.current = new Date();

    try {
      await apiTriggerSync();
      startProgressTick();
      stopPolling();
      pollRef.current = setInterval(checkStatus, POLL_INTERVAL);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Erreur de synchronisation';
      setError(msg);
      setSyncing(false);
      setProgress(0);
      syncStartedAtRef.current = null;
      stopTick();
    }
  }, [checkStatus, startProgressTick, stopPolling, stopTick]);

  return (
    <SyncContext.Provider
      value={{
        syncing,
        progress,
        lastSyncAt,
        error,
        success,
        triggerSync,
        syncCompletedCount,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}
