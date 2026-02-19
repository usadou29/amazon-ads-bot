'use client';
import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardFooter } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MetricCard } from '@/components/ui/MetricCard';
import { Button } from '@/components/ui/Button';
import { t } from '@/lib/i18n';
import { StatusResult } from '@/lib/transforms/status';
import { HumanMetric } from '@/lib/transforms/metrics';
export interface BookCardData { id: string; title: string; asin: string; marketplace: string; metrics: HumanMetric[]; status: StatusResult; pendingRecommendations: number; }
export function BookCard({ book }: { book: BookCardData }) {
  return (<Card hoverable><CardContent><div className="flex items-start justify-between mb-2"><div className="flex-1 min-w-0"><h3 className="text-base font-semibold text-slate-900 truncate">{book.title}</h3><p className="text-xs text-slate-400 mt-0.5">{book.asin} · {book.marketplace}</p></div><StatusBadge type={book.status.type} label={book.status.label} emoji={book.status.emoji} size="sm" /></div><p className="text-sm text-slate-600 mb-3">{book.status.description}</p><div className="grid grid-cols-2 gap-2">{book.metrics.slice(0, 4).map((m) => (<MetricCard key={m.label} metric={m} compact />))}</div>{book.pendingRecommendations > 0 && (<div className="mt-3"><span className="inline-flex items-center gap-1 text-xs font-medium text-accent-700 bg-accent-50 px-2 py-1 rounded-full">{'💡'} {book.pendingRecommendations} conseil(s)</span></div>)}</CardContent><CardFooter><Link href={`/books/${book.id}`}><Button variant="secondary" size="sm" fullWidth>{t('books.open')} →</Button></Link></CardFooter></Card>);
}
