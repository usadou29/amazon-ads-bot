'use client';
import React from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { SafetyBanner } from '@/components/ui/SafetyBanner';
import { useSafety } from '@/lib/hooks/useSafety';
export function ClientLayout({ children }: { children: React.ReactNode }) {
  const safety = useSafety();
  return (<div className="min-h-screen bg-slate-50"><SafetyBanner dryRun={safety.dryRun} killSwitch={safety.killSwitch} /><Navbar /><main className="max-w-5xl mx-auto px-4 py-6">{children}</main></div>);
}
