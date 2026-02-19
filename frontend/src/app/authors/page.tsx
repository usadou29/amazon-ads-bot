'use client';
import React, { useEffect, useState } from 'react';
import { AuthorCard, AuthorCardData } from '@/components/features/AuthorCard';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { t } from '@/lib/i18n';
import { fetchAuthors } from '@/lib/api/client';
import { transformKPIs } from '@/lib/transforms/metrics';
import { StatusResult } from '@/lib/transforms/status';
export default function AuthorsPage() {
  const [authors, setAuthors] = useState<AuthorCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchAuthors()
      .then((data: any[]) => {
        setAuthors(data.map((a) => {
          const kpis = transformKPIs({ spend: a.metrics.spend, sales: a.metrics.sales, acos: a.metrics.acos, roas: a.metrics.roas, impressions: a.metrics.impressions, clicks: a.metrics.clicks, orders: a.metrics.orders });
          const status: StatusResult = { type: a.status === 'no_data' ? 'warning' : a.status, label: a.status === 'success' ? 'Sous contrôle' : a.status === 'warning' ? 'À optimiser' : a.status === 'danger' ? 'Attention' : 'Données insuffisantes', emoji: a.status === 'success' ? '✅' : a.status === 'warning' ? '⚠️' : a.status === 'danger' ? '🛑' : '📊', description: '' };
          return { id: a.id, name: a.name, bookCount: a.bookCount, metrics: kpis, status, pendingRecommendations: a.pendingRecommendations };
        }));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return (<div><h1 className="text-2xl font-bold text-slate-900 mb-6">{t('authors.title')}</h1><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{[1,2,3].map((i) => <CardSkeleton key={i} />)}</div></div>);
  if (error) return (<div className="text-center py-12"><p className="text-red-600">{t('common.error')}</p><p className="text-sm text-slate-500 mt-2">{error}</p></div>);
  if (authors.length === 0) return (<div className="text-center py-12"><p className="text-xl text-slate-600">{t('authors.empty')}</p><p className="text-sm text-slate-400 mt-2">{t('authors.empty_hint')}</p></div>);
  return (<div><h1 className="text-2xl font-bold text-slate-900 mb-6">{t('authors.title')}</h1><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{authors.map((a) => <AuthorCard key={a.id} author={a} />)}</div></div>);
}
