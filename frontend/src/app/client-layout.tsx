'use client';
import React from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SafetyBanner } from '@/components/ui/SafetyBanner';
import { SyncProgressBar } from '@/components/features/SyncProgressBar';
import { SyncProvider } from '@/lib/contexts/SyncContext';
import { useSafety } from '@/lib/hooks/useSafety';
import { Toaster } from '@/lib/toast';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const safety = useSafety();
  return (
    <SyncProvider>
      <div className="min-h-screen bg-slate-50">
        <SafetyBanner dryRun={safety.dryRun} killSwitch={safety.killSwitch} />
        <Navbar />
        <SyncProgressBar />
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
        <Toaster />
      </div>
    </SyncProvider>
  );
}
