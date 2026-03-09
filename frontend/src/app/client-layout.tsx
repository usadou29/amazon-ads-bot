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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30 relative overflow-hidden">
        {/* Background decorative elements */}
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-gradient-to-br from-violet-200/20 to-transparent rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-gradient-to-tl from-blue-200/20 to-transparent rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-white/50 to-transparent rounded-full" />
        </div>
        
        <div className="relative z-10">
          <SafetyBanner dryRun={safety.dryRun} killSwitch={safety.killSwitch} />
          <Navbar />
          <SyncProgressBar />
          <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
          <Toaster />
        </div>
      </div>
    </SyncProvider>
  );
}
