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
      <div className="min-h-screen bg-[#0f172a] relative overflow-hidden font-sans">
        {/* Animated gradient background */}
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-slate-900 to-purple-950" />
          
          {/* Animated orbs */}
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px] animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[120px]" />
          
          {/* Grid pattern */}
          <div 
            className="absolute inset-0 opacity-[0.02]"
            style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                               linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
              backgroundSize: '50px 50px'
            }}
          />
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
