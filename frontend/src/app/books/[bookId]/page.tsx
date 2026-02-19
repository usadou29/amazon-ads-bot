'use client';
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { MetricsGrid } from '@/components/ui/MetricCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { RecommendationCard } from '@/components/features/RecommendationCard';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { useSafety } from '@/lib/hooks/useSafety';
import { fetchBookDashboard, approveRecommendation, rejectRecommendation, dryRunAction, executeAction } from '@/lib/api/client';
import { transformKPIs, generateVerbalSummary } from '@/lib/transforms/metrics';
import { computeStatus, StatusResult } from '@/lib/transforms/status';
import { transformRecommendation, HumanRecommendation } from '@/lib/transforms/recommendations';
import { t } from '@/lib/i18n';
export default function BookDetailPage() {
  const params = useParams();
  const bookId = params.bookId as string;
  const safety = useSafety();
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!bookId) return;
    fetchBookDashboard(bookId)
      .then(setDashboard)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [bookId]);
  if (loading) return (<div><div className="mb-6"><Link href="/authors" className="text-sm text-brand-600 hover:text-brand-700">← {t('common.back')}</Link></div><div className="space-y-4">{[1,2,3].map((i) => <CardSkeleton key={i} />)}</div></div>);
  if (error || !dashboard) return (<div className="text-center py-12"><p className="text-red-600">{t('common.error')}</p><p className="text-sm text-slate-500 mt-2">{error}</p></div>);
  const { book, metrics, trends, recommendations, recentActions, dailyMetrics } = dashboard;
  const kpis = transformKPIs(metrics, trends?.changes);
  const status: StatusResult = computeStatus({ acosTarget: book.acosTarget, acos: metrics.acos, roas: metrics.roas, impressions: metrics.impressions });
  const verbalSummary = generateVerbalSummary(kpis, book.title);
  const humanRecos: HumanRecommendation[] = recommendations.map((r: any) => transformRecommendation(r, safety.dryRun));
  const safetyMessage = safety.killSwitch ? t('safety.kill_switch_title') : safety.dryRun ? t('safety.dry_run_title') : undefined;
  return (<div><div className="mb-4"><Link href={`/authors/${encodeURIComponent(book.author?.toLowerCase().replace(/\s+/g, '-') || 'unknown')}`} className="text-sm text-brand-600 hover:text-brand-700">← {book.author}</Link></div><div className="flex items-start justify-between mb-6"><div><h1 className="text-2xl font-bold text-slate-900">{book.title}</h1><p className="text-sm text-slate-500 mt-1">{book.asin} · {book.marketplace}</p></div><StatusBadge type={status.type} label={status.label} emoji={status.emoji} /></div><Card className="mb-6 border-l-4 border-l-accent-500"><CardContent><p className="text-sm text-slate-700 leading-relaxed">{verbalSummary}</p></CardContent></Card><div className="mb-6"><MetricsGrid metrics={kpis} /></div>{humanRecos.length > 0 && (<div className="mb-6"><h2 className="text-lg font-semibold text-slate-900 mb-4">{t('recommendations.title')} ({humanRecos.length})</h2><div className="space-y-4">{humanRecos.map((reco) => (<RecommendationCard key={reco.id} recommendation={reco} onSimulate={async (id) => { await dryRunAction(id); }} onApply={async (id) => { await approveRecommendation(id); await executeAction(id); }} onReject={async (id) => { await rejectRecommendation(id); }} safetyBlocked={!safety.canExecute} safetyMessage={safetyMessage} />))}</div></div>)}{dailyMetrics && dailyMetrics.length > 0 && (<Card className="mb-6"><CardHeader><CardTitle>{t('book_detail.chart_title')}</CardTitle></CardHeader><CardContent><div className="h-48 flex items-center justify-center border border-slate-200 rounded-lg bg-slate-50"><p className="text-sm text-slate-500">📈 Graphique — {dailyMetrics.length} jours de données</p></div></CardContent></Card>)}{recentActions && recentActions.length > 0 && (<Card><CardHeader><CardTitle>{t('book_detail.timeline_title')}</CardTitle></CardHeader><CardContent><div className="space-y-3">{recentActions.slice(0, 10).map((a: any) => (<div key={a.id} className="flex items-start gap-3 text-sm"><span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${a.dryRun ? 'bg-brand-500' : a.status === 'success' ? 'bg-emerald-500' : a.status === 'failed' ? 'bg-red-500' : 'bg-slate-400'}`} /><div className="flex-1 min-w-0"><p className="text-slate-700 truncate">{a.actionType} — {a.rationale}</p><p className="text-xs text-slate-400">{new Date(a.createdAt).toLocaleDateString('fr-FR')}{a.dryRun && <span className="ml-2 text-brand-600">[simulation]</span>}</p></div></div>))}</div></CardContent></Card>)}</div>);
}
