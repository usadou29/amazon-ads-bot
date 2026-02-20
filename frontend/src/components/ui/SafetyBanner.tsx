'use client';
import React from 'react';
import { t } from '@/lib/i18n';
interface SafetyBannerProps { dryRun: boolean; killSwitch: boolean; }
export function SafetyBanner({ dryRun, killSwitch }: SafetyBannerProps) {
  if (killSwitch) return (<div className="bg-red-50 border-b border-red-200 px-4 py-2.5 text-center"><span className="text-sm font-medium text-red-800">{'⛔ '}{t('safety.kill_switch_title')}{' — '}<span className="font-normal">{t('safety.kill_switch_desc')}</span></span></div>);
  if (dryRun) return (<div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 text-center"><span className="text-sm font-medium text-blue-800">{'🔒 '}{t('safety.dry_run_title')}{' — '}<span className="font-normal">{t('safety.dry_run_desc')}</span></span></div>);
  return null;
}
