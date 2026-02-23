'use client';
import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { MetricsGrid } from '@/components/ui/MetricCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { RoyaltyEditor, RoyaltyValues } from '@/components/features/RoyaltyEditor';
import { CampaignDetailView } from '@/components/features/CampaignDetailView';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { useSafety } from '@/lib/hooks/useSafety';
import {
  fetchBookDashboard,
  fetchBookCampaignDetails,
  approveRecommendation,
  rejectRecommendation,
  dryRunAction,
  executeAction,
  updateBook,
  getWorkspaceId,
  refreshBookData,
} from '@/lib/api/client';
import { OverviewCampaignView } from '@/components/features/OverviewCampaignView';
import { transformKPIs, generateVerbalSummary, formatCurrency, computeRevenue, interpretAdsDependency, DEFAULT_ROYALTY_RATE } from '@/lib/transforms/metrics';
import { computeStatus, StatusResult } from '@/lib/transforms/status';
import { transformRecommendation, HumanRecommendation, groupRecommendationsByEntity, RecommendationGroup } from '@/lib/transforms/recommendations';
import { t } from '@/lib/i18n';
import { useSyncContext } from '@/lib/contexts/SyncContext';

export default function BookDetailPage() {
  const params = useParams();
  const bookId = params.bookId as string;
  const safety = useSafety();
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'advanced'>('overview');

  // Édition de la redevance
  const [editingRoyalty, setEditingRoyalty] = useState(false);
  const [savingRoyalty, setSavingRoyalty] = useState(false);
  const [royaltySaved, setRoyaltySaved] = useState(false);
  const [royaltyError, setRoyaltyError] = useState<string | null>(null);

  // Édition image de couverture
  const [editingCover, setEditingCover] = useState(false);
  const [coverUrlValue, setCoverUrlValue] = useState('');
  const [savingCover, setSavingCover] = useState(false);

  // Édition date de publication & phase
  const [editingPubDate, setEditingPubDate] = useState(false);
  const [pubDateValue, setPubDateValue] = useState('');
  const [savingPubDate, setSavingPubDate] = useState(false);
  const [showPhaseOverride, setShowPhaseOverride] = useState(false);

  // Filtre campagnes actives/inactives
  const [includeInactive, setIncludeInactive] = useState(false);

  // Overview campaign details
  const [overviewCampaignDetails, setOverviewCampaignDetails] = useState<any>(null);
  const [overviewDays, setOverviewDays] = useState(14);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // Recharger après synchro
  const { syncCompletedCount } = useSyncContext();

  const royaltyValuesRef = useRef<RoyaltyValues>({ royaltyRate: null, salePrice: null, royaltyPerUnit: null });

  useEffect(() => {
    if (!bookId) return;
    setLoading(true);
    fetchBookDashboard(bookId, includeInactive)
      .then(setDashboard)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [bookId, includeInactive, syncCompletedCount]);

  // Fetch campaign details for overview tab
  useEffect(() => {
    if (!bookId) return;
    setOverviewLoading(true);
    fetchBookCampaignDetails(bookId, overviewDays)
      .then(setOverviewCampaignDetails)
      .catch(() => setOverviewCampaignDetails(null))
      .finally(() => setOverviewLoading(false));
  }, [bookId, overviewDays, syncCompletedCount]);

  // Refresh all data from Amazon API on page load (background)
  // Ensures displayed bids, metrics (impressions, clicks, spend, sales) match current Amazon values
  const dataRefreshedRef = useRef(false);
  useEffect(() => {
    if (!bookId || dataRefreshedRef.current) return;
    dataRefreshedRef.current = true;
    refreshBookData(bookId).then((result) => {
      // Toujours recharger les données après refresh pour garantir la conformité avec Amazon
      // Les enchères sont mises à jour de manière synchrone, les rapports en arrière-plan
      fetchBookCampaignDetails(bookId, overviewDays)
        .then(setOverviewCampaignDetails)
        .catch(() => {});
      fetchBookDashboard(bookId, includeInactive)
        .then(setDashboard)
        .catch(() => {});
    }).catch(() => {});
  }, [bookId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveRoyalty = async () => {
    setSavingRoyalty(true);
    setRoyaltyError(null);
    try {
      const rv = royaltyValuesRef.current;
      await updateBook(bookId, {
        royaltyRate: rv.royaltyRate ?? undefined,
        salePrice: rv.salePrice ?? undefined,
        royaltyPerUnit: rv.royaltyPerUnit ?? undefined,
      });
      // Recharger le dashboard
      const updatedDashboard = await fetchBookDashboard(bookId, includeInactive);
      setDashboard(updatedDashboard);
      setEditingRoyalty(false);
      setRoyaltySaved(true);
      setTimeout(() => setRoyaltySaved(false), 3000);
    } catch (err: any) {
      setRoyaltyError(err.response?.data?.message || err.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSavingRoyalty(false);
    }
  };

  const handleSavePubDate = async () => {
    setSavingPubDate(true);
    try {
      await updateBook(bookId, { publicationDate: pubDateValue || undefined });
      const updated = await fetchBookDashboard(bookId, includeInactive);
      setDashboard(updated);
      setEditingPubDate(false);
    } catch (err: any) {
      // silently fail
    } finally {
      setSavingPubDate(false);
    }
  };

  const handleSaveCover = async () => {
    setSavingCover(true);
    try {
      await updateBook(bookId, { coverImageUrl: coverUrlValue.trim() || null });
      const updated = await fetchBookDashboard(bookId, includeInactive);
      setDashboard(updated);
      setEditingCover(false);
    } catch (err: any) {
      // silently fail
    } finally {
      setSavingCover(false);
    }
  };

  const handlePhaseOverride = async (phase: string | null) => {
    try {
      await updateBook(bookId, { lifecyclePhaseOverride: phase });
      const updated = await fetchBookDashboard(bookId, includeInactive);
      setDashboard(updated);
    } catch (err: any) {
      // silently fail
    }
  };

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <Link href="/" className="text-sm text-brand-600 hover:text-brand-700">← Mes livres</Link>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{t('common.error')}</p>
        <p className="text-sm text-slate-500 mt-2">{error}</p>
      </div>
    );
  }

  const { book, metrics, trends, recommendations, recentActions, dailyMetrics, campaigns: bookCampaigns } = dashboard;
  const m = metrics || {};
  const sales = Number(m.sales || 0);
  const spend = Number(m.spend || 0);
  const royaltyRate = book.royaltyRate ? Number(book.royaltyRate) : null;
  const revenue = computeRevenue(sales, royaltyRate);
  const profit = revenue - spend;
  const rate = royaltyRate && royaltyRate > 0 ? royaltyRate : DEFAULT_ROYALTY_RATE;
  const isEstimated = !royaltyRate || royaltyRate <= 0;

  // Info prix/redevance par livre (si renseigné en mode précis)
  const hasPreciseMode = book.salePrice && book.royaltyPerUnit;

  // Phase de cycle de vie
  const phaseInfo = book.phaseInfo || { phase: 'scale', label: 'Croissance', emoji: '📈', explanation: '', color: 'amber' };
  const phaseColorMap: Record<string, { bg: string; border: string; text: string }> = {
    blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800' },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800' },
    purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800' },
  };
  const phaseColors = phaseColorMap[phaseInfo.color] || phaseColorMap.amber;

  // Indice de dépendance publicitaire (calculé côté backend)
  const depScore = dashboard.adsDependencyScore ?? -1;
  const depInfo = interpretAdsDependency(depScore);

  const status: StatusResult = computeStatus({
    acosTarget: book.acosTarget ? Number(book.acosTarget) : 40,
    acos: m.acos ?? null,
    roas: m.roas ?? null,
    impressions: Number(m.impressions || 0),
    spend,
    sales,
    royaltyRate,
  });

  const kpis = transformKPIs(m, trends?.changes);
  const verbalSummary = generateVerbalSummary(kpis, book.title, royaltyRate);
  const humanRecos: HumanRecommendation[] = (recommendations || []).map((r: any) =>
    transformRecommendation(r, safety.dryRun),
  );
  // Ne garder que les recos recommandées par le Strategy Engine (score >= 70, recommendedForLifecycle = true)
  // Les recos avec score=0 (ex: pause bloquée par le hard guard économique) ne doivent pas apparaître comme "conseils"
  const recommendedRecos = humanRecos.filter(r => r.recommendedForLifecycle);
  const recoGroups: RecommendationGroup[] = groupRecommendationsByEntity(recommendedRecos);

  // Build recommendation map for overview campaign view (entityKey → RecommendationGroup[])
  const recommendationMap = new Map<string, RecommendationGroup[]>();
  for (const group of recoGroups) {
    const existing = recommendationMap.get(group.entityKey) || [];
    existing.push(group);
    recommendationMap.set(group.entityKey, existing);
  }

  const safetyMessage = safety.killSwitch
    ? t('safety.kill_switch_title')
    : safety.dryRun
      ? t('safety.dry_run_title')
      : undefined;

  const profitColor = profit > 0 ? 'text-emerald-700' : profit < 0 ? 'text-red-600' : 'text-slate-600';
  const acosTarget = book.acosTarget ? Number(book.acosTarget) : 40;

  return (
    <div>
      {/* ── Navigation retour ── */}
      <div className="mb-4">
        <Link href="/" className="text-sm text-brand-600 hover:text-brand-700">← Mes livres</Link>
      </div>

      {/* ── En-tête du livre ── */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">
          {/* Couverture du livre — cliquable pour éditer */}
          <div className="relative group/cover flex-shrink-0">
            {book.coverImageUrl ? (
              <img
                src={book.coverImageUrl}
                alt={book.title || book.asin}
                className="w-20 h-28 rounded-lg object-cover shadow-md cursor-pointer"
                onClick={() => { setCoverUrlValue(book.coverImageUrl || ''); setEditingCover(true); }}
              />
            ) : (
              <div
                className="w-20 h-28 rounded-lg bg-slate-200 flex items-center justify-center text-3xl cursor-pointer"
                onClick={() => { setCoverUrlValue(''); setEditingCover(true); }}
              >
                {status.emoji}
              </div>
            )}
            <div
              className="absolute inset-0 rounded-lg bg-black/40 opacity-0 group-hover/cover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
              onClick={() => { setCoverUrlValue(book.coverImageUrl || ''); setEditingCover(true); }}
            >
              <span className="text-white text-xs font-medium">Modifier</span>
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{book.title || book.asin}</h1>
            {book.author && <p className="text-sm text-slate-500 mt-0.5">{book.author}</p>}
            <p className="text-xs text-slate-400 mt-1">{book.asin} · {book.marketplace}</p>
            {hasPreciseMode && (
              <p className="text-xs text-slate-400 mt-0.5">
                Prix : {Number(book.salePrice).toFixed(2)}€ · Redevance : {Number(book.royaltyPerUnit).toFixed(2)}€/livre
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge type={status.type} label={status.label} emoji={status.emoji} />
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-slate-500">Inclure inactives</span>
            <button
              type="button"
              role="switch"
              aria-checked={includeInactive}
              onClick={() => setIncludeInactive(!includeInactive)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                includeInactive ? 'bg-brand-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  includeInactive ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
        </div>
      </div>

      {/* ── Édition couverture (inline) ── */}
      {editingCover && (
        <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">URL de l'image de couverture</label>
              <input
                type="url"
                value={coverUrlValue}
                onChange={(e) => setCoverUrlValue(e.target.value)}
                placeholder="https://m.media-amazon.com/images/I/..."
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Clic droit sur la couverture Amazon → Copier l'adresse de l'image
              </p>
            </div>
            {coverUrlValue.trim() && (
              <img
                src={coverUrlValue.trim()}
                alt="Aperçu"
                className="w-12 h-18 rounded object-cover border border-slate-200"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                onLoad={(e) => { (e.target as HTMLImageElement).style.display = 'block'; }}
              />
            )}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSaveCover}
              disabled={savingCover}
              className="px-3 py-1 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-lg"
            >
              {savingCover ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            <button
              onClick={() => setEditingCover(false)}
              className="px-3 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
            >
              Annuler
            </button>
            {book.coverImageUrl && (
              <button
                onClick={async () => {
                  setSavingCover(true);
                  try {
                    await updateBook(bookId, { coverImageUrl: null });
                    const updated = await fetchBookDashboard(bookId, includeInactive);
                    setDashboard(updated);
                    setEditingCover(false);
                  } finally { setSavingCover(false); }
                }}
                disabled={savingCover}
                className="px-3 py-1 text-xs font-medium text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded-lg ml-auto"
              >
                Supprimer l'image
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Phase de cycle de vie ── */}
      <div className={`mb-6 p-3 ${phaseColors.bg} border ${phaseColors.border} rounded-lg`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{phaseInfo.emoji}</span>
            <div>
              <p className={`text-sm font-semibold ${phaseColors.text}`}>
                {phaseInfo.label}
                {book.lifecyclePhaseOverride && (
                  <span className="ml-2 text-xs font-normal opacity-70">(forcé manuellement)</span>
                )}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">{phaseInfo.explanation}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Date de publication */}
            {!editingPubDate ? (
              <button
                onClick={() => {
                  setPubDateValue(book.publicationDate || '');
                  setEditingPubDate(true);
                }}
                className="text-xs text-slate-500 hover:text-slate-700 whitespace-nowrap"
              >
                {book.publicationDate
                  ? `Publié le ${new Date(book.publicationDate).toLocaleDateString('fr-FR')}`
                  : 'Ajouter date de publication'}
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={pubDateValue}
                  onChange={(e) => setPubDateValue(e.target.value)}
                  className="px-2 py-1 text-xs border border-slate-300 rounded"
                />
                <button
                  onClick={handleSavePubDate}
                  disabled={savingPubDate}
                  className="px-2 py-1 text-xs bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
                >
                  {savingPubDate ? '...' : 'OK'}
                </button>
                <button
                  onClick={() => setEditingPubDate(false)}
                  className="px-1 py-1 text-xs text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Phase override (avancé) */}
        <div className="mt-2">
          {!showPhaseOverride ? (
            <button
              onClick={() => setShowPhaseOverride(true)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Forcer une autre phase...
            </button>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <select
                value={book.lifecyclePhaseOverride || ''}
                onChange={(e) => {
                  handlePhaseOverride(e.target.value || null);
                  setShowPhaseOverride(false);
                }}
                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="">Auto-détection</option>
                <option value="launch">Lancement</option>
                <option value="scale">Croissance</option>
                <option value="evergreen">Régime de croisière</option>
                <option value="relaunch">Relance</option>
              </select>
              <button
                onClick={() => setShowPhaseOverride(false)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Annuler
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Résumé en langage naturel ── */}
      <Card className="mb-6 border-l-4 border-l-accent-500">
        <CardContent>
          <p className="text-sm text-slate-700 leading-relaxed">{verbalSummary}</p>
        </CardContent>
      </Card>

      {/* ── Chiffres clés ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <p className={`text-2xl font-bold ${profitColor}`}>
            {profit >= 0 ? '+' : ''}{profit.toFixed(0)}€
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Gains réels{isEstimated ? ' (estimé)' : ''}
          </p>
        </div>
        <div
          className="bg-white rounded-xl border border-slate-200 p-4 text-center cursor-pointer hover:border-brand-300 hover:shadow-sm transition-all group relative"
          onClick={() => !editingRoyalty && setEditingRoyalty(true)}
        >
          <p className="text-2xl font-bold text-slate-700">{formatCurrency(revenue)}</p>
          <p className="text-xs text-slate-500 mt-1">
            Redevances ({rate}%)
            <span className="ml-1 text-brand-500 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
          </p>
          {royaltySaved && (
            <span className="absolute top-2 right-2 text-xs text-emerald-600 font-medium animate-pulse">✓ Sauvé</span>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <p className="text-2xl font-bold text-slate-700">{formatCurrency(spend)}</p>
          <p className="text-xs text-slate-500 mt-1">Dépensé en pub</p>
        </div>
        {depScore >= 0 && (
          <div className={`rounded-xl border p-4 text-center ${depInfo.bgColor} ${depInfo.borderColor}`}>
            <p className="text-lg font-bold">
              {depInfo.emoji}
            </p>
            <p className={`text-xs font-medium mt-1 ${depInfo.color}`}>
              {depInfo.label}
            </p>
          </div>
        )}
      </div>

      {/* ── Indice de dépendance publicitaire ── */}
      {depScore >= 0 && (
        <div className={`mb-6 p-3 ${depInfo.bgColor} border ${depInfo.borderColor} rounded-lg`}>
          <div className="flex items-start gap-2">
            <span className="text-sm mt-0.5">{depInfo.emoji}</span>
            <div>
              <p className={`text-xs font-semibold mb-1 ${depInfo.color}`}>
                {depInfo.label}
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                {depInfo.explanation}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Édition de la redevance (inline avec RoyaltyEditor) ── */}
      {editingRoyalty && (
        <div className="mb-6 p-4 bg-white rounded-xl border-2 border-brand-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Modifier ta redevance</h3>
            <button
              onClick={() => { setEditingRoyalty(false); setRoyaltyError(null); }}
              className="text-sm text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>

          <RoyaltyEditor
            initialRate={royaltyRate}
            initialSalePrice={book.salePrice ? Number(book.salePrice) : null}
            initialRoyaltyPerUnit={book.royaltyPerUnit ? Number(book.royaltyPerUnit) : null}
            onChange={(values) => { royaltyValuesRef.current = values; }}
          />

          {royaltyError && (
            <p className="text-xs text-red-600 mt-2">{royaltyError}</p>
          )}

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => { setEditingRoyalty(false); setRoyaltyError(null); }}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSaveRoyalty}
              disabled={savingRoyalty}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {savingRoyalty ? 'Sauvegarde...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {/* ── Info redevance estimée ── */}
      {isEstimated && sales > 0 && !editingRoyalty && (
        <div
          className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer hover:bg-amber-100 transition-colors"
          onClick={() => setEditingRoyalty(true)}
        >
          <p className="text-xs text-amber-700">
            Les gains sont estimés à 25% des ventes Amazon.{' '}
            <span className="font-semibold underline">Clique ici pour renseigner ta vraie redevance KDP</span> et avoir un calcul précis.
          </p>
        </div>
      )}

      {/* ── Encart pédagogique ── */}
      {sales > 0 && (
        <div className="mb-6 p-3 bg-blue-50 border border-blue-100 rounded-lg">
          <p className="text-xs text-blue-800 leading-relaxed mb-2">
            <span className="font-semibold">Ces chiffres ne comptent que les ventes via Amazon Ads</span>, pas tes ventes organiques. Même en perte sur la pub, ton livre peut être rentable au global.
          </p>
          <p className="text-xs text-blue-700 leading-relaxed">
            La pub a deux objectifs : <span className="font-medium">1)</span> positionner ton livre en première page sur les bons mots-clés, ce qui génère des ventes organiques non comptées ici, et <span className="font-medium">2)</span> faire du profit direct, mais c'est plus long à obtenir.
          </p>
        </div>
      )}

      {/* ── Onglets ── */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {[
          { key: 'overview' as const, label: t('book_detail.tab_overview') },
          { key: 'details' as const, label: t('book_detail.tab_details') },
          { key: 'advanced' as const, label: 'Campagnes' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════ ONGLET 1: Vue d'ensemble ══════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {m.acos !== null && m.acos !== undefined && (
            <Card>
              <CardContent>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">
                  {t('book_detail.efficiency_title')}
                </h3>
                {(() => {
                  const effScore = Math.max(0, Math.min(100, 100 - Number(m.acos)));
                  const effTarget = Math.max(0, Math.min(100, 100 - acosTarget));
                  return (
                    <>
                      <p className="text-xs text-slate-500 mb-3">
                        {t('book_detail.efficiency_desc').replace('{target}', String(effTarget))}
                      </p>
                      <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            effScore >= effTarget
                              ? 'bg-emerald-500'
                              : effScore >= effTarget * 0.7
                                ? 'bg-amber-400'
                                : 'bg-red-500'
                          }`}
                          style={{ width: `${effScore}%` }}
                        />
                        <div
                          className="absolute top-0 h-full w-0.5 bg-slate-400"
                          style={{ left: `${effTarget}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-1 text-xs text-slate-400">
                        <span>0%</span>
                        <span className="font-medium text-slate-600">
                          Ton score : {effScore.toFixed(1)}% (cible : ≥{effTarget}%)
                        </span>
                        <span>100%</span>
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {/* ── Campagnes avec recommandations intégrées ── */}
          <OverviewCampaignView
            bookId={bookId}
            campaignDetails={overviewCampaignDetails}
            recommendationMap={recommendationMap}
            handlers={{
              onSimulate: async (id) => { await dryRunAction(id); },
              onApply: async (id) => {
                await approveRecommendation(id);
                await executeAction(id);
                const updated = await fetchBookDashboard(bookId, includeInactive);
                setDashboard(updated);
              },
              onReject: async (id) => {
                await rejectRecommendation(id);
                const updated = await fetchBookDashboard(bookId, includeInactive);
                setDashboard(updated);
              },
            }}
            safetyBlocked={!safety.canExecute}
            safetyMessage={safetyMessage}
            days={overviewDays}
            onDaysChange={setOverviewDays}
            loading={overviewLoading}
            lifecyclePhase={phaseInfo.phase as any}
            workspaceId={getWorkspaceId()}
            acosTarget={acosTarget}
            onActionExecuted={async () => {
              const updated = await fetchBookDashboard(bookId, includeInactive);
              setDashboard(updated);
              const updatedDetails = await fetchBookCampaignDetails(bookId, overviewDays);
              setOverviewCampaignDetails(updatedDetails);
            }}
          />
        </div>
      )}

      {/* ══════════════ ONGLET 2: Détails ══════════════ */}
      {activeTab === 'details' && (
        <div className="space-y-6">
          <MetricsGrid metrics={kpis} />

          {dailyMetrics && dailyMetrics.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t('book_detail.chart_title')}</CardTitle></CardHeader>
              <CardContent>
                <div className="h-48 flex items-center justify-center border border-slate-200 rounded-lg bg-slate-50">
                  <p className="text-sm text-slate-500">Graphique — {dailyMetrics.length} jours de données</p>
                </div>
              </CardContent>
            </Card>
          )}

          {recentActions && recentActions.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t('book_detail.timeline_title')}</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentActions.slice(0, 10).map((a: any) => (
                    <div key={a.id} className="flex items-start gap-3 text-sm">
                      <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                        a.dryRun ? 'bg-brand-500' : a.status === 'success' ? 'bg-emerald-500' : a.status === 'failed' ? 'bg-red-500' : 'bg-slate-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-700 truncate">{a.actionType} — {a.rationale}</p>
                        <p className="text-xs text-slate-400">
                          {new Date(a.createdAt).toLocaleDateString('fr-FR')}
                          {a.dryRun && <span className="ml-2 text-brand-600">[simulation]</span>}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════ ONGLET 3: Campagnes — Vue détaillée ══════════════ */}
      {activeTab === 'advanced' && (
        <CampaignDetailView bookId={bookId} syncCompletedCount={syncCompletedCount} />
      )}
    </div>
  );
}
