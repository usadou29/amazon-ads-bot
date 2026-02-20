'use client';
import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { MetricsGrid } from '@/components/ui/MetricCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { RecommendationCard } from '@/components/features/RecommendationCard';
import { RoyaltyEditor, RoyaltyValues } from '@/components/features/RoyaltyEditor';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { useSafety } from '@/lib/hooks/useSafety';
import {
  fetchBookDashboard,
  approveRecommendation,
  rejectRecommendation,
  dryRunAction,
  executeAction,
  updateBook,
} from '@/lib/api/client';
import { transformKPIs, generateVerbalSummary, formatCurrency, computeRevenue, interpretAdsDependency, DEFAULT_ROYALTY_RATE } from '@/lib/transforms/metrics';
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
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'advanced'>('overview');

  // Édition de la redevance
  const [editingRoyalty, setEditingRoyalty] = useState(false);
  const [savingRoyalty, setSavingRoyalty] = useState(false);
  const [royaltySaved, setRoyaltySaved] = useState(false);
  const [royaltyError, setRoyaltyError] = useState<string | null>(null);

  // Édition date de publication & phase
  const [editingPubDate, setEditingPubDate] = useState(false);
  const [pubDateValue, setPubDateValue] = useState('');
  const [savingPubDate, setSavingPubDate] = useState(false);
  const [showPhaseOverride, setShowPhaseOverride] = useState(false);

  const royaltyValuesRef = useRef<RoyaltyValues>({ royaltyRate: null, salePrice: null, royaltyPerUnit: null });

  useEffect(() => {
    if (!bookId) return;
    fetchBookDashboard(bookId)
      .then(setDashboard)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [bookId]);

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
      const updatedDashboard = await fetchBookDashboard(bookId);
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
      const updated = await fetchBookDashboard(bookId);
      setDashboard(updated);
      setEditingPubDate(false);
    } catch (err: any) {
      // silently fail
    } finally {
      setSavingPubDate(false);
    }
  };

  const handlePhaseOverride = async (phase: string | null) => {
    try {
      await updateBook(bookId, { lifecyclePhaseOverride: phase });
      const updated = await fetchBookDashboard(bookId);
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

  const { book, metrics, trends, recommendations, recentActions, dailyMetrics } = dashboard;
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
          <div className="w-16 h-24 rounded-lg bg-slate-200 flex-shrink-0 flex items-center justify-center text-2xl">
            {status.emoji}
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
        <StatusBadge type={status.type} label={status.label} emoji={status.emoji} />
      </div>

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
          { key: 'advanced' as const, label: t('book_detail.tab_advanced') },
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
                <p className="text-xs text-slate-500 mb-3">
                  {t('book_detail.efficiency_desc').replace('{target}', String(acosTarget))}
                </p>
                <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      Number(m.acos) <= acosTarget
                        ? 'bg-emerald-500'
                        : Number(m.acos) <= acosTarget * 1.5
                          ? 'bg-amber-400'
                          : 'bg-red-500'
                    }`}
                    style={{ width: `${Math.min(Number(m.acos), 100)}%` }}
                  />
                  <div
                    className="absolute top-0 h-full w-0.5 bg-slate-400"
                    style={{ left: `${Math.min(acosTarget, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-xs text-slate-400">
                  <span>0%</span>
                  <span className="font-medium text-slate-600">
                    Ton score : {Number(m.acos).toFixed(1)}% (cible : {acosTarget}%)
                  </span>
                  <span>100%</span>
                </div>
              </CardContent>
            </Card>
          )}

          {humanRecos.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Mes conseils pour toi ({humanRecos.length})
                </h2>
                <p className="text-xs text-slate-400">
                  Basé sur les 30 derniers jours
                </p>
              </div>
              <div className="space-y-4">
                {humanRecos.map((reco) => (
                  <RecommendationCard
                    key={reco.id}
                    recommendation={reco}
                    onSimulate={async (id) => { await dryRunAction(id); }}
                    onApply={async (id) => {
                      await approveRecommendation(id);
                      await executeAction(id);
                      // Recharger le dashboard après action
                      const updated = await fetchBookDashboard(bookId);
                      setDashboard(updated);
                    }}
                    onReject={async (id) => {
                      await rejectRecommendation(id);
                      // Retirer la reco de la liste
                      const updated = await fetchBookDashboard(bookId);
                      setDashboard(updated);
                    }}
                    safetyBlocked={!safety.canExecute}
                    safetyMessage={safetyMessage}
                  />
                ))}
              </div>
            </div>
          )}

          {humanRecos.length === 0 && (
            <Card className="border-l-4 border-l-emerald-400">
              <CardContent>
                <div className="text-center py-4">
                  <p className="text-base font-medium text-emerald-700 mb-1">Tout roule !</p>
                  <p className="text-sm text-slate-500">
                    Pas de conseil pour le moment. Tes campagnes tournent bien. On te préviendra dès qu'on détecte une opportunité.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
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

      {/* ══════════════ ONGLET 3: Avancé ══════════════ */}
      {activeTab === 'advanced' && (
        <div className="space-y-6">
          <Card>
            <CardContent>
              <p className="text-sm text-slate-500 text-center py-8">
                Campagnes, mots-clés et ciblage avancé — bientôt disponible.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
