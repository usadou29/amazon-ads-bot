'use client';
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { triggerSync as apiTriggerSync, fetchSyncStatus } from '@/lib/api/client';

const DEFAULT_ESTIMATED_DURATION = 120; // 2 minutes par défaut (réduit grâce au parallélisme backend)
const POLL_INTERVAL = 5000; // 5 secondes
const PROGRESS_TICK_INTERVAL = 500; // Mise à jour visuelle chaque 0.5s pour plus de fluidité
const LOCALSTORAGE_KEY = 'endromede_sync_duration';

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
  /** Durée estimée en secondes (pour affichage ETA) */
  estimatedDuration: number;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSyncContext(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    throw new Error('useSyncContext must be used within a SyncProvider');
  }
  return ctx;
}

/**
 * Calcule une progression asymptotique.
 * Monte rapidement au début puis ralentit progressivement.
 * Ne dépasse jamais 95% — les derniers 5% viennent de la confirmation backend.
 *
 * Utilise une courbe exponentielle inversée : 1 - e^(-k*t)
 * où k est calibré pour que progress ≈ 90% quand elapsed = estimatedDuration
 */
function computeAsymptoticProgress(elapsed: number, estimated: number): number {
  if (elapsed <= 0 || estimated <= 0) return 0;

  // k calibré pour que 1 - e^(-k*1) ≈ 0.90 quand elapsed = estimated
  // => k = -ln(0.10) ≈ 2.30
  const k = 2.3;
  const ratio = elapsed / estimated;
  const raw = (1 - Math.exp(-k * ratio)) * 100;

  // Cap à 95% — le 100% vient du backend
  return Math.min(Math.round(raw * 10) / 10, 95);
}

/**
 * Récupère la durée estimée depuis localStorage
 */
function getStoredDuration(): number {
  if (typeof window === 'undefined') return DEFAULT_ESTIMATED_DURATION;
  try {
    const stored = localStorage.getItem(LOCALSTORAGE_KEY);
    if (stored) {
      const val = parseInt(stored, 10);
      if (!isNaN(val) && val > 10) return val;
    }
  } catch {
    // localStorage indisponible
  }
  return DEFAULT_ESTIMATED_DURATION;
}

function storeDuration(seconds: number): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCALSTORAGE_KEY, String(Math.round(seconds)));
  } catch {
    // Ignore
  }
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [syncCompletedCount, setSyncCompletedCount] = useState(0);
  const [estimatedDuration, setEstimatedDuration] = useState(getStoredDuration);

  // Refs pour éviter les closures stales
  const syncingRef = useRef(false);
  const estimatedDurationRef = useRef(getStoredDuration());
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

  // Tick de progression : met à jour le % estimé chaque 0.5s
  const startProgressTick = useCallback(() => {
    stopTick();
    tickRef.current = setInterval(() => {
      if (!syncStartedAtRef.current) return;
      const elapsed = (Date.now() - syncStartedAtRef.current.getTime()) / 1000;
      const estimated = estimatedDurationRef.current;
      const prog = computeAsymptoticProgress(elapsed, estimated);
      setProgress(prog);
    }, PROGRESS_TICK_INTERVAL);
  }, [stopTick]);

  const handleSyncComplete = useCallback(() => {
    // Enregistrer la durée réelle pour la prochaine fois
    if (syncStartedAtRef.current) {
      const actualDuration = (Date.now() - syncStartedAtRef.current.getTime()) / 1000;
      // Moyenne pondérée : 70% nouvelle valeur + 30% ancienne
      const smoothed = Math.round(actualDuration * 0.7 + estimatedDurationRef.current * 0.3);
      estimatedDurationRef.current = smoothed;
      setEstimatedDuration(smoothed);
      storeDuration(smoothed);
    }

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

      // Mémoriser la durée estimée du backend
      if (data.lastSyncDurationSeconds && data.lastSyncDurationSeconds > 0) {
        const backendDuration = Number(data.lastSyncDurationSeconds);
        // Moyenne entre localStorage et backend pour plus de précision
        const blended = Math.round((backendDuration + estimatedDurationRef.current) / 2);
        estimatedDurationRef.current = blended;
        setEstimatedDuration(blended);
        storeDuration(blended);
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
          const backendDuration = Number(data.lastSyncDurationSeconds);
          const storedDuration = getStoredDuration();
          const blended = Math.round((backendDuration + storedDuration) / 2);
          estimatedDurationRef.current = blended;
          setEstimatedDuration(blended);
          storeDuration(blended);
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
        estimatedDuration,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}
