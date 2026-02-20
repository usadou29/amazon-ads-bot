'use client';
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { BookCard, BookCardData } from '@/components/features/BookCard';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { t } from '@/lib/i18n';
import { fetchAuthorBooks } from '@/lib/api/client';
import { computeStatus } from '@/lib/transforms/status';
import { formatCurrency, computeRevenue, computeProfit, DEFAULT_ROYALTY_RATE } from '@/lib/transforms/metrics';

export default function AuthorBooksPage() {
  const params = useParams();
  const authorId = params.authorId as string;
  const [books, setBooks] = useState<BookCardData[]>([]);
  const [authorName, setAuthorName] = useState('');
  const [totals, setTotals] = useState({ profit: 0, sales: 0, spend: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authorId) return;
    fetchAuthorBooks(authorId)
      .then((data: any[]) => {
        if (data.length > 0) setAuthorName(data[0].author);

        let totalSales = 0;
        let totalSpend = 0;

        const enrichedBooks: BookCardData[] = data.map((b: any) => {
          const m = b.metrics || {};
          const sales = Number(m.sales || 0);
          const spend = Number(m.spend || 0);
          const royaltyRate = b.royaltyRate ? Number(b.royaltyRate) : null;
          const revenue = computeRevenue(sales, royaltyRate);
          const profit = revenue - spend;
          const rate = royaltyRate && royaltyRate > 0 ? royaltyRate : DEFAULT_ROYALTY_RATE;
          const isEstimated = !royaltyRate || royaltyRate <= 0;

          totalSales += sales;
          totalSpend += spend;

          const status = computeStatus({
            acosTarget: b.acosTarget ? Number(b.acosTarget) : 40,
            acos: m.acos ?? null,
            roas: m.roas ?? null,
            impressions: Number(m.impressions || 0),
            spend,
            sales,
            royaltyRate,
          });

          return {
            id: b.id,
            title: b.title || b.asin,
            asin: b.asin,
            marketplace: b.marketplace,
            author: b.author,
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
            pendingRecommendations: b.pendingRecommendations || 0,
            royaltyRate: rate,
            isEstimated,
          };
        });

        // Trier : en perte d'abord
        const statusOrder: Record<string, number> = { danger: 0, warning: 1, success: 2 };
        enrichedBooks.sort((a, b) => (statusOrder[a.status.type] ?? 9) - (statusOrder[b.status.type] ?? 9));

        const totalProfit = enrichedBooks.reduce((sum, b) => sum + b.profit, 0);
        setBooks(enrichedBooks);
        setTotals({ profit: totalProfit, sales: totalSales, spend: totalSpend });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [authorId]);

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <Link href="/authors" className="text-sm text-brand-600 hover:text-brand-700">
            ← {t('common.back')}
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{t('common.error')}</p>
        <p className="text-sm text-slate-500 mt-2">{error}</p>
      </div>
    );
  }

  const profitColor = totals.profit > 0 ? 'text-emerald-700' : totals.profit < 0 ? 'text-red-600' : 'text-slate-700';

  return (
    <div>
      <div className="mb-4">
        <Link href="/authors" className="text-sm text-brand-600 hover:text-brand-700">
          ← {t('common.back')}
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-slate-900 mb-2">{authorName}</h1>
      <p className="text-sm text-slate-500 mb-6">
        {books.length} livre{books.length > 1 ? 's' : ''} · Profit total :{' '}
        <span className={`font-semibold ${profitColor}`}>
          {totals.profit >= 0 ? '+' : ''}{totals.profit.toFixed(0)}€
        </span>
      </p>

      {books.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-xl text-slate-600">{t('books.empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {books.map((b) => (
            <BookCard
              key={b.id}
              book={b}
              onDeleted={(deletedId) => {
                setBooks((prev) => prev.filter((x) => x.id !== deletedId));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
