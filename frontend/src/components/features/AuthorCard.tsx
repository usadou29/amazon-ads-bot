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
export interface AuthorCardData { id: string; name: string; bookCount: number; metrics: HumanMetric[]; status: StatusResult; pendingRecommendations: number; }
export function AuthorCard({ author }: { author: AuthorCardData }) {
  return (<Card hoverable><CardContent><div className="flex items-start justify-between mb-3"><div><h3 className="text-lg font-semibold text-slate-900">{author.name}</h3><p className="text-sm text-slate-500">{t('authors.books_count', { count: author.bookCount })}</p></div><StatusBadge type={author.status.type} label={author.status.label} emoji={author.status.emoji} size="sm" /></div><div className="space-y-2">{author.metrics.slice(0, 3).map((m) => (<MetricCard key={m.label} metric={m} compact />))}</div>{author.pendingRecommendations > 0 && (<div className="mt-3"><span className="inline-flex items-center gap-1 text-xs font-medium text-accent-700 bg-accent-50 px-2 py-1 rounded-full">{'💡'} {author.pendingRecommendations} conseil(s) en attente</span></div>)}</CardContent><CardFooter><Link href={`/authors/${encodeURIComponent(author.id)}`}><Button variant="secondary" size="sm" fullWidth>{t('authors.see_books')} →</Button></Link></CardFooter></Card>);
}
