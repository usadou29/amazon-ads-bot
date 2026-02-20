'use client';
import React from 'react';
import { StatusType } from '@/lib/theme/tokens';
interface StatusBadgeProps { type: StatusType; label: string; emoji?: string; size?: 'sm' | 'md'; }
const badgeStyles: Record<StatusType, string> = {
  success: 'bg-status-success-bg text-emerald-700 border-emerald-200',
  warning: 'bg-status-warning-bg text-amber-700 border-amber-200',
  danger: 'bg-status-danger-bg text-red-700 border-red-200',
};
const defaultEmojis: Record<StatusType, string> = { success: '✅', warning: '⚠️', danger: '🛑' };
export function StatusBadge({ type, label, emoji, size = 'md' }: StatusBadgeProps) {
  return (<span className={`inline-flex items-center gap-1.5 border rounded-full font-medium ${badgeStyles[type]} ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'}`}><span>{emoji ?? defaultEmojis[type]}</span><span>{label}</span></span>);
}
