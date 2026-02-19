'use client';
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { BookCard, BookCardData } from '@/components/features/BookCard';
import { MetricsGrid } from '@/components/ui/MetricCard';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { t } from '@/lib/i18n';
import { fetchAuthorBooks } from '@/lib/api/client';
import { transformKPIs, HumanMetric } from '@/lib/transforms/metrics';
import { StatusResult } from '@/lib/transforms/status';
export default function AuthorBooksPage() {
  const params = useParams();
  const authorId = params.authorId as string;
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [authorName, setAuthorName] = useState('');
  const [aggregatedMetrics, setAggregatedMetrics] = useState<HumanMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!authorId) return;
    fetchAuthorBooks(authorId)
      .then((data: any[]) => {
        if (data.length > 0) setAuthorName(data[0].author);
        const totals = data.reduce((acc, b) => ({ spend: acc.spend + (b.metrics?.spend || 0), sales: acc.sales + (b.metrics?.sales || 0), impressions: acc.impressions + (b.metrics?.impressions || 0), clicks: acc.clicks + (b.metrics?.clicks || 0), orders: acc.orders + (b.metrics?.orders || 0) }), { spend: 0, sales: 0, impressions: 0, clicks: 0, orders: 0 });
        totals.acos = totals.sales > 0 ? (totals.spend / totals.sales) * 100 : null;
        totals.roas = totals.spend > 0 ? totals.sales / totals.spend : null;
        setAggregatedMetrics(transformKPIs(totals));
        setBooks(data.map((b: any) => {
          const kpis = transformKPIs({ spend: b.metrics.spend, sales: b.metrics.sales, acos: b.metrics.acos, roas: b.metrics.roas, impressions: b.metrics.impressions, clicks: b.metrics.clicks, orders: b.metrics.orders });
          const status: StatusResult = { type: b.status === 'no_data' ? 'warning' : b.status, label: b.status === 'success' ? 'Sous contrôle' : b.status === 'warning' ? 'À optimiser' : b.status === 'danger' ? 'Attention' : 'Données insuffisantes', emoji: b.status === 'success' ? '✅' : b.status === 'warning' ? '⚠️' : b.status === 'danger' ? '🛑' : '📊', description: `ACOS ${b.metrics.acos?.toFixed(1) || '—'}% · ROAS ${b.metrics.roas?.toFixed(2) || '—'}` };
          return { id: b.id, title: b.title, asin: b.asin, marketplace: b.marketplace, metrics: kpis, status, pendingRecommendations: b.pendingRecommendations };
        }));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [authorId]);
  if (loading) return (<div><div className="mb-6"><Link href="/authors" className="text-sm text-brand-600 hover:text-brand-700">← {t('common.back')}</Link></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[1,2].map((i) => <CardSkeleton key={i} />)}</div></div>);
  if (error) return (<div className="text-center py-12"><p className="text-red-600">{t('common.error')}</p><p className="text-sm text-slate-500 mt-2">{error}</p></div>);
  return (<div><div className="mb-4"><Link href="/authors" className="text-sm text-brand-600 hover:text-brand-700">← {t('common.back')}</Link></div><h1 className="text-2xl font-bold text-slate-900 mb-4">{authorName}</h1>{aggregatedMetrics.length > 0 && <div className="mb-6"><MetricsGrid metrics={aggregatedMetrics} /></div>}{books.length === 0 ? (<div className="text-center py-12"><p className="text-xl text-slate-600">{t('books.empty')}</p></div>) : (<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{books.map((b) => <BookCard key={b.id} book={b} />)}</div>)}</div>);
}
