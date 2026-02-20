'use client';
import { useState, useEffect, useCallback } from 'react';
import { fetchKillSwitchStatus, fetchFeatureFlag } from '@/lib/api/client';

interface SafetyState { dryRun: boolean; killSwitch: boolean; autoExecuteEnabled: boolean; canExecute: boolean; refresh: () => void; }

export function useSafety(): SafetyState {
  const [dryRun, setDryRun] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [autoExec, setAutoExec] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const ks = await fetchKillSwitchStatus();
      setKillSwitch(ks.active ?? false);
      const ae = await fetchFeatureFlag('auto_execute_enabled');
      setAutoExec(ae.enabled ?? false);
      setDryRun(!ae.enabled);
    } catch { setDryRun(true); setKillSwitch(false); setAutoExec(false); }
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 30000); return () => clearInterval(id); }, [refresh]);

  return { dryRun, killSwitch, autoExecuteEnabled: autoExec, canExecute: !killSwitch && autoExec && !dryRun, refresh };
}
