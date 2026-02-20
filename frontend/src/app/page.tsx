'use client';
import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { OnboardingSection } from '@/components/features/OnboardingSection';
import { CreateBookModal } from '@/components/features/CreateBookModal';
import { LinkCampaignsModal } from '@/components/features/LinkCampaignsModal';
import { SyncButton } from '@/components/features/SyncButton';
import { BookCard, BookCardData } from '@/components/features/BookCard';
import { t } from '@/lib/i18n';
import {
  fetchBooks,
  fetchBookDashboard,
  getWorkspaceId,
} from '@/lib/api/client';
import { computeStatus } from '@/lib/transforms/status';
import { formatCurrency, computeRevenue, DEFAULT_ROYALTY_RATE } from '@/lib/transforms/metrics';

interface BookDashboard {
  book: any;
  metrics: any;
  recommendations: any[];
}

export default function HomePage() {
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateBook, setShowCreateBook] = useState(false);
  const [showLinkCampaigns, setShowLinkCampaigns] = useState(false);
  const [createdBook, setCreatedBook] = useState<{ id: string; title: string } | null>(null);

  // Totaux pour le résumé
  const [totals, setTotals] = useState({ profit: 0, sales: 0, spend: 0, revenue: 0 });

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
    loadBooks();
  }, []);

  async function loadBooks() {
    try {
      // 1. Charger la liste des livres
      const bookList = await fetchBooks();
      if (!Array.isArray(bookList) || bookList.length === 0) {
        setBooks([]);
        setLoading(false);
        return;
      }

      // 2. Charger le dashboard de chaque livre en parallèle
      const dashboards = await Promise.allSettled(
        bookList.map((b: any) => fetchBookDashboard(b.id))
      );

      let totalSales = 0;
      let totalSpend = 0;

      const enrichedBooks: BookCardData[] = dashboards
        .map((result, idx) => {
          const rawBook = bookList[idx];
          if (result.status !== 'fulfilled') {
            // Livre sans données encore
            return {
              id: rawBook.id,
              title: rawBook.title || rawBook.asin,
              asin: rawBook.asin,
              marketplace: rawBook.marketplace,
              author: rawBook.author,
              status: computeStatus({ impressions: 0 }),
              profit: 0,
              profitFormatted: '0€',
              revenue: 0,
              revenueFormatted: '0.00 €',
              sales: 0,
              salesFormatted: '0.00 €',
              spend: 0,
              spendFormatted: '0.00 €',
              orders: 0,
              pendingRecommendations: 0,
              royaltyRate: DEFAULT_ROYALTY_RATE,
              isEstimated: true,
            } as BookCardData;
          }

          const dash: BookDashboard = result.value;
          const m = dash.metrics || {};
          const sales = Number(m.sales || 0);
          const spend = Number(m.spend || 0);
          const royaltyRate = dash.book?.royaltyRate ? Number(dash.book.royaltyRate) : null;
          const revenue = computeRevenue(sales, royaltyRate);
          const profit = revenue - spend;
          const rate = royaltyRate && royaltyRate > 0 ? royaltyRate : DEFAULT_ROYALTY_RATE;
          const isEstimated = !royaltyRate || royaltyRate <= 0;

          totalSales += sales;
          totalSpend += spend;

          const status = computeStatus({
            acosTarget: dash.book?.acosTarget ? Number(dash.book.acosTarget) : 40,
            acos: m.acos ?? null,
            roas: m.roas ?? null,
            impressions: Number(m.impressions || 0),
            spend,
            sales,
            royaltyRate,
          });

          return {
            id: rawBook.id,
            title: dash.book?.title || rawBook.title || rawBook.asin,
            asin: rawBook.asin,
            marketplace: rawBook.marketplace,
            author: dash.book?.author || rawBook.author,
            status,
            profit,
            profitFormatted: `${profit >= 0 ? '+' : ''}${profit.toFixed(0)}€`,
            revenue,
            revenueFormatted: formatCurrency(revenue),
            sales,
            salesFormatted: formatCurrency(sales),
            spend,
            spendFormatted: formatCurrency(spend),
            orders: Number(m.orders || 0),
            pendingRecommendations: Array.isArray(dash.recommendations) ? dash.recommendations.length : 0,
            royaltyRate: rate,
            isEstimated,
          } as BookCardData;
        });

      // Trier : en perte d'abord, puis fragile, puis rentable
      const statusOrder: Record<string, number> = { danger: 0, warning: 1, success: 2 };
      enrichedBooks.sort((a, b) => (statusOrder[a.status.type] ?? 9) - (statusOrder[b.status.type] ?? 9));

      // Calculer le profit total et les redevances totales à partir des profits par livre
      const totalProfit = enrichedBooks.reduce((sum, b) => sum + b.profit, 0);
      const totalRevenue = enrichedBooks.reduce((sum, b) => sum + b.revenue, 0);
      setBooks(enrichedBooks);
      setTotals({
        profit: totalProfit,
        sales: totalSales,
        spend: totalSpend,
        revenue: totalRevenue,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">{t('home.title')}</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const hasBooks = books.length > 0;
  const profitColor = totals.profit > 0 ? 'text-emerald-700' : totals.profit < 0 ? 'text-red-600' : 'text-slate-700';
  const countByStatus = {
    success: books.filter((b) => b.status.type === 'success').length,
    warning: books.filter((b) => b.status.type === 'warning').length,
    danger: books.filter((b) => b.status.type === 'danger').length,
  };

  return (
    <div className="space-y-6">
      {/* ═══ Header ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('home.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('home.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <SyncButton />
          <Button variant="accent" size="sm" onClick={() => setShowCreateBook(true)}>
            + {t('home.add_book')}
          </Button>
        </div>
      </div>

      {/* ═══ Bilan du mois ═══ */}
      {hasBooks && (
        <Card className="bg-gradient-to-r from-slate-50 to-white">
          <CardContent>
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">
              {t('home.profit_title')}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Profit — le chiffre clé */}
              <div className="text-center">
                <p className={`text-3xl font-bold ${profitColor}`}>
                  {totals.profit >= 0 ? '+' : ''}{totals.profit.toFixed(0)}€
                </p>
                <p className="text-xs text-slate-500 mt-1">{t('home.total_profit')}</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-semibold text-slate-700">
                  {formatCurrency(totals.sales)}
                </p>
                <p className="text-xs text-slate-500 mt-1">{t('home.total_sales')}</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-semibold text-emerald-600">
                  {formatCurrency(totals.revenue)}
                </p>
                <p className="text-xs text-slate-500 mt-1">Redevances estimées</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-semibold text-slate-700">
                  {formatCurrency(totals.spend)}
                </p>
                <p className="text-xs text-slate-500 mt-1">{t('home.total_spend')}</p>
              </div>
            </div>


            {/* Mini résumé statuts */}
            <div className="flex items-center justify-center gap-4 mt-4 text-xs">
              {countByStatus.success > 0 && (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  {countByStatus.success} rentable{countByStatus.success > 1 ? 's' : ''}
                </span>
              )}
              {countByStatus.warning > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  {countByStatus.warning} fragile{countByStatus.warning > 1 ? 's' : ''}
                </span>
              )}
              {countByStatus.danger > 0 && (
                <span className="inline-flex items-center gap-1 text-red-600">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {countByStatus.danger} en perte
                </span>
              )}
            </div>

            {/* ── Encart pédagogique : ventes pub uniquement ── */}
            <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-xs text-blue-800 leading-relaxed">
                <span className="font-semibold">Uniquement les ventes pub.</span> Ces chiffres ne comptent que les ventes générées par Amazon Ads, pas tes ventes organiques. Même si le bilan pub semble négatif, ton livre peut être rentable : la pub aide aussi à positionner ton livre en première page sur les bons mots-clés, ce qui génère des ventes organiques non comptées ici.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ Onboarding si pas de livres ═══ */}
      {!hasBooks && <OnboardingSection />}

      {/* ═══ Catalogue de livres ═══ */}
      {hasBooks && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onDeleted={(deletedId) => {
                setBooks((prev) => prev.filter((b) => b.id !== deletedId));
              }}
            />
          ))}
        </div>
      )}

      {/* ═══ Message si pas de données mais livres présents ═══ */}
      {hasBooks && books.every((b) => b.status.type === 'warning' && b.profit === 0 && b.sales === 0) && (
        <Card>
          <CardContent>
            <p className="text-sm text-slate-500 text-center py-4">
              {t('home.no_data')}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ═══ Modals ═══ */}
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
