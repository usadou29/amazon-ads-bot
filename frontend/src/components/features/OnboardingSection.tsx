'use client';
import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CreateBookModal } from './CreateBookModal';
import { CampaignsListModal } from './CampaignsListModal';
import { LinkCampaignsModal } from './LinkCampaignsModal';
import { t } from '@/lib/i18n';

export function OnboardingSection() {
  const [showBookModal, setShowBookModal] = useState(false);
  const [showCampaignsModal, setShowCampaignsModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  // After book creation, store its info so we can link campaigns
  const [createdBook, setCreatedBook] = useState<{ id: string; title: string } | null>(null);

  const handleBookCreated = (book: { id: string; title: string }) => {
    setShowBookModal(false);
    setCreatedBook(book);
    // Immediately prompt to link campaigns
    setShowLinkModal(true);
  };

  const handleLinkDone = () => {
    setShowLinkModal(false);
    setCreatedBook(null);
    window.location.reload();
  };

  return (
    <>
      <Card className="bg-gradient-to-r from-accent-50 to-brand-50 border-2 border-accent-200">
        <CardContent>
          <h3 className="text-lg font-semibold text-accent-700 mb-2">
            {t('onboarding.title')}
          </h3>
          <p className="text-sm text-slate-600 mb-4">
            {t('onboarding.description')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <Button variant="accent" size="md" onClick={() => setShowBookModal(true)}>
              {t('onboarding.create_first_book')}
            </Button>
            <Button variant="secondary" size="md" onClick={() => setShowCampaignsModal(true)}>
              {t('onboarding.see_campaigns')}
            </Button>
          </div>

          <div className="p-3 bg-white/70 rounded-lg border border-slate-200">
            <h4 className="font-semibold text-sm text-slate-900 mb-1">
              {t('onboarding.concept_title')}
            </h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              {t('onboarding.concept_desc')}
            </p>
          </div>
        </CardContent>
      </Card>

      <CreateBookModal
        open={showBookModal}
        onClose={() => setShowBookModal(false)}
        onSuccess={handleBookCreated}
      />

      <CampaignsListModal
        open={showCampaignsModal}
        onClose={() => setShowCampaignsModal(false)}
      />

      {createdBook && (
        <LinkCampaignsModal
          open={showLinkModal}
          onClose={handleLinkDone}
          bookId={createdBook.id}
          bookTitle={createdBook.title}
          onLinked={handleLinkDone}
        />
      )}
    </>
  );
}
