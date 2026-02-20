'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { MetricsGrid } from '@/components/ui/MetricCard';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { OnboardingSection } from '@/components/features/OnboardingSection';
import { CreateBookModal } from '@/components/features/CreateBookModal';
import { LinkCampaignsModal } from '@/components/features/LinkCampaignsModal';
import { t } from '@/lib/i18n';
import {
  fetchMetricsSummary,
  fetchTopPerformers,
  fetchRecommendationsPending,
  fetchRecommendationStats,
  fetchAuthors,
  getWorkspaceId,
} from '@/lib/api/client';
import { transformKPIs, formatCurrency, formatNumber } from '@/lib/transforms/metrics';
import { transformRecommendation } from '@/lib/transforms/recommendations';

export default function HomePage() {
  const [metrics, setMetrics] = useState<any>(null);
  const [topCampaigns, setTopCampaigns] = useState<any[]>([]);
  const [pendingRecos, setPendingRecos] = useState<any[]>([]);
  const [recoStats, setRecoStats] = useState<any>(null);
  const [hasBooks, setHasBooks] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateBook, setShowCreateBook] = useState(false);
  const [showLinkCampaigns, setShowLinkCampaigns] = useState(false);
  const [createdBook, setCreatedBook] = useState<{ id: string; title: string } | null>(null);

  const handleBookCreated = (book: { id: string; title: string }) => {
    setShowCreateBook(false);
    setCreatedBook(book);
    setShowLinkCampaigns(true);
  };

  const handleLinkDone = () => {
    setShowLinkCampaigns(false);
    setCreatedBook(null);
    window.location.reload();
  };

  useEffect(() => {
    Promise.allSettled([
      fetchMetricsSummary(),
      fetchTopPerformers('campaign', 'sales', 5),
      fetchRecommendationsPending(5),
      fetchRecommendationStats(),
      fetchAuthors(),
    ])
      .then(([metricsRes, topRes, recosRes, statsRes, authorsRes]) => {
        if (metricsRes.status === 'fulfilled') setMetrics(metricsRes.value);
        if (topRes.status === 'fulfilled') setTopCampaigns(topRes.value?.items || topRes.value || []);
        if (recosRes.status === 'fulfilled') setPendingRecos(recosRes.value?.items || recosRes.value || []);
        if (statsRes.status === 'fulfilled') setRecoStats(statsRes.value);
        if (authorsRes.status === 'fulfilled') {
          const authors = authorsRes.value;
          setHasBooks(Array.isArray(authors) && authors.length > 0);
        } else {
          setHasBooks(false);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">{t('home.title')}</h1>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  // Build KPIs from metrics response
  const kpis = metrics?.kpis
    ? transformKPIs(metrics.kpis, metrics.changes || {})
    : [];

  const pendingCount = recoStats?.pending ?? pendingRecos.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t('home.title')}</h1>
        <Button variant="accent" size="sm" onClick={() => setShowCreateBook(true)}>
          + {t('home.add_book')}
        </Button>
      </div>

      {/* Global KPIs */}
      {kpis.length > 0 ? (
        <section>
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">
            {t('home.kpis_title')}
          </h2>
          <MetricsGrid metrics={kpis} />
        </section>
      ) : (
        <Card>
          <CardContent>
            <p className="text-sm text-slate-500 text-center py-4">{t('home.no_data')}</p>
          </CardContent>
        </Card>
      )}

      {/* Onboarding if no books */}
      {!hasBooks && <OnboardingSection />}

      {/* Top 5 Campaigns */}
      <Card>
        <CardHeader>
          <CardTitle>{t('home.top_campaigns')}</CardTitle>
        </CardHeader>
        <CardContent>
          {topCampaigns.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">{t('home.no_campaigns')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500 uppercase">#</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500 uppercase">Campagne</th>
                    <th className="text-right py-2 pr-4 text-xs font-medium text-slate-500 uppercase">Ventes</th>
                    <th className="text-right py-2 pr-4 text-xs font-medium text-slate-500 uppercase">Dépenses</th>
                    <th className="text-right py-2 pr-4 text-xs font-medium text-slate-500 uppercase">ACOS</th>
                    <th className="text-right py-2 text-xs font-medium text-slate-500 uppercase">Clics</th>
                  </tr>
                </thead>
                <tbody>
                  {topCampaigns.map((c: any, i: number) => {
                    const k = c.kpis || c;
                    return (
                      <tr key={c.entityKey || i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 pr-4 text-slate-400 font-medium">{i + 1}</td>
                        <td className="py-2 pr-4 text-slate-900 font-medium max-w-[250px] truncate">
                          {c.entityName || c.name || c.entityKey || '—'}
                        </td>
                        <td className="py-2 pr-4 text-right text-slate-700">
                          {formatCurrency(Number(k.sales || 0))}
                        </td>
                        <td className="py-2 pr-4 text-right text-slate-700">
                          {formatCurrency(Number(k.spend || 0))}
                        </td>
                        <td className="py-2 pr-4 text-right text-slate-700">
                          {k.acos != null ? `${Number(k.acos).toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2 text-right text-slate-700">
                          {formatNumber(Number(k.clicks || 0))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t('home.recommendations_title')} ({pendingCount})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingRecos.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">
              Aucune recommandation en attente
            </p>
          ) : (
            <div className="space-y-3">
              {pendingRecos.slice(0, 5).map((r: any) => {
                const hr = transformRecommendation(r, true);
                return (
                  <div
                    key={r.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50"
                  >
                    <span
                      className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                        hr.riskLevel === 'low'
                          ? 'bg-emerald-500'
                          : hr.riskLevel === 'medium'
                            ? 'bg-amber-500'
                            : 'bg-red-500'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{hr.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{hr.why}</p>
                    </div>
                    <span className="text-xs text-slate-400 flex-shrink-0">
                      {hr.riskLevel === 'low' ? 'Risque faible' : hr.riskLevel === 'medium' ? 'Risque moyen' : 'Risque élevé'}
                    </span>
                  </div>
                );
              })}
              {pendingCount > 5 && (
                <p className="text-xs text-brand-600 text-center pt-2">
                  + {pendingCount - 5} autre(s) recommandation(s)
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modals — always available */}
      <CreateBookModal
        open={showCreateBook}
        onClose={() => setShowCreateBook(false)}
        onSuccess={handleBookCreated}
      />
      {createdBook && (
        <LinkCampaignsModal
          open={showLinkCampaigns}
          onClose={handleLinkDone}
          bookId={createdBook.id}
          bookTitle={createdBook.title}
          onLinked={handleLinkDone}
        />
      )}
    </div>
  );
}
