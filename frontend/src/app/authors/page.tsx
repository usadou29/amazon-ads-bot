'use client';
import React, { useEffect, useState } from 'react';
import { AuthorCard, AuthorCardData } from '@/components/features/AuthorCard';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { OnboardingSection } from '@/components/features/OnboardingSection';
import { CreateBookModal } from '@/components/features/CreateBookModal';
import { LinkCampaignsModal } from '@/components/features/LinkCampaignsModal';
import { t } from '@/lib/i18n';
import { fetchAuthors, getWorkspaceId } from '@/lib/api/client';
import { transformKPIs } from '@/lib/transforms/metrics';
import { StatusResult } from '@/lib/transforms/status';

export default function AuthorsPage() {
  const [authors, setAuthors] = useState<AuthorCardData[]>([]);
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
    fetchAuthors()
      .then((data: any) => {
        if (!Array.isArray(data)) {
          console.error('[ENDROMEDE] API /authors did not return an array:', data);
          setError(`L'API a renvoyé une réponse inattendue`);
          return;
        }

        setAuthors(
          data.map((a: any) => {
            const kpis = transformKPIs({
              spend: a.metrics?.spend ?? 0,
              sales: a.metrics?.sales ?? 0,
              acos: a.metrics?.acos ?? null,
              roas: a.metrics?.roas ?? null,
              impressions: a.metrics?.impressions ?? 0,
              clicks: a.metrics?.clicks ?? 0,
              orders: a.metrics?.orders ?? 0,
            });

            const status: StatusResult = {
              type: a.status === 'no_data' ? 'warning' : a.status,
              label:
                a.status === 'success'
                  ? 'Sous contrôle'
                  : a.status === 'warning'
                    ? 'À optimiser'
                    : a.status === 'danger'
                      ? 'Attention'
                      : 'Données insuffisantes',
              emoji:
                a.status === 'success'
                  ? '✅'
                  : a.status === 'warning'
                    ? '⚠️'
                    : a.status === 'danger'
                      ? '🛑'
                      : '📊',
              description: '',
            };

            return {
              id: a.id,
              name: a.name,
              bookCount: a.bookCount,
              metrics: kpis,
              status,
              pendingRecommendations: a.pendingRecommendations,
            };
          }),
        );
      })
      .catch((e: any) => {
        if (e.response) {
          setError(`Erreur API ${e.response.status}: ${e.response.data?.message || e.response.statusText}`);
        } else if (e.request) {
          setError('Impossible de contacter le backend. Vérifiez que le serveur NestJS tourne sur le port 3001.');
        } else {
          setError(e.message || 'Erreur inconnue');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-6">{t('authors.title')}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 text-lg font-semibold">{t('common.error')}</p>
        <p className="text-sm text-red-500 mt-2 max-w-lg mx-auto">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 transition-colors"
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (authors.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-6">{t('authors.title')}</h1>
        <OnboardingSection />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{t('authors.title')}</h1>
        <Button variant="accent" size="sm" onClick={() => setShowCreateBook(true)}>
          + {t('home.add_book')}
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {authors.map((a) => (
          <AuthorCard key={a.id} author={a} />
        ))}
      </div>

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
