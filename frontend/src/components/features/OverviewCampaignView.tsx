'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { RecommendationCard } from '@/components/features/RecommendationCard';
import { CampaignInsightCard } from '@/components/features/CampaignInsightCard';
import { EntityInsightPopover } from '@/components/features/EntityInsightPopover';
import { ActionModal } from '@/components/features/ActionModal';
import { BidActionPopover } from '@/components/features/BidActionPopover';
import { RecommendationGroup, refreshRecommendationTexts } from '@/lib/transforms/recommendations';
import { type CampaignInsight, type EntityInsight, EXECUTION_COLORS, renderEntityInsight } from '@/lib/transforms/insights';
import { selectDefaultAction, insightActionToSuggestionItem, type ActionSuggestionItem } from '@/lib/action-selection';
import { t } from '@/lib/i18n';
import { fetchBookCampaignDetails } from '@/lib/api/client';

// ── Types ──
interface TargetMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
  acos: number;
  ctr: number;
  cvr: number;
  cpc: number;
  impressionShare: number | null;
}

interface KeywordItem {
  id: string;
  amazonKeywordId: string;
  keywordText: string;
  matchType: string;
  matchTypeRaw: string;
  state: string;
  bid: number | null;
  metrics: TargetMetrics;
  insight?: EntityInsight;
}

interface ProductTargetItem {
  id: string;
  amazonTargetId: string;
  expressionType: string;
  expression: string;
  state: string;
  bid: number | null;
  metrics: TargetMetrics;
  insight?: EntityInsight;
}

interface CampaignDetail {
  id: string;
  name: string;
  campaignType: string;
  state: string;
  targetingType: string | null;
  dailyBudget: number | null;
  biddingStrategy: string | null;
  isPrimary: boolean;
  metrics: TargetMetrics;
  keywords: KeywordItem[];
  productTargets: ProductTargetItem[];
  insight?: CampaignInsight;
}

interface CampaignDetailsResponse {
  campaigns: CampaignDetail[];
  periodDays: number;
  lifecyclePhase?: 'launch' | 'scale' | 'evergreen' | 'relaunch';
  breakEvenAcos?: number;
}

interface RecoHandlers {
  onSimulate: (id: string) => Promise<void>;
  onApply: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

interface OverviewCampaignViewProps {
  bookId: string;
  campaignDetails: CampaignDetailsResponse | null;
  recommendationMap: Map<string, RecommendationGroup[]>;
  handlers: RecoHandlers;
  safetyBlocked: boolean;
  safetyMessage?: string;
  days: number;
  onDaysChange: (days: number) => void;
  loading: boolean;
  lifecyclePhase?: 'launch' | 'scale' | 'evergreen' | 'relaunch';
  workspaceId?: string;
  acosTarget?: number;
  onActionExecuted?: () => void;
}

// ── Helpers ──
const stateConfig: Record<string, { label: string; bg: string; text: string }> = {
  enabled: { label: 'Active', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  paused: { label: 'En pause', bg: 'bg-amber-100', text: 'text-amber-700' },
  archived: { label: 'Archivée', bg: 'bg-slate-100', text: 'text-slate-500' },
};

const typeLabels: Record<string, string> = {
  sponsoredProducts: 'Sponsored Products',
  sponsoredBrands: 'Sponsored Brands',
  sponsoredDisplay: 'Sponsored Display',
};

function formatEur(v: number): string {
  return `${v.toFixed(2)} €`;
}

function formatPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function formatInt(v: number): string {
  return v.toLocaleString('fr-FR');
}

// ── Impression Share Indicator ──
// Voyant coloré pour la part d'impressions (topOfSearchImpressionShare)
function ImpressionShareBadge({ share }: { share: number | null }) {
  if (share == null) {
    return <span className="text-[10px] text-slate-300">—</span>;
  }
  // share est un % (0-100)
  let color: string;
  let label: string;
  if (share >= 20) {
    color = 'bg-emerald-500'; // Très bien placé
    label = 'Top';
  } else if (share >= 10) {
    color = 'bg-emerald-300'; // Bien placé
    label = 'Bon';
  } else if (share >= 5) {
    color = 'bg-amber-400'; // Moyen
    label = 'Moyen';
  } else if (share > 0) {
    color = 'bg-orange-400'; // Faible
    label = 'Faible';
  } else {
    color = 'bg-red-400'; // Absent
    label = 'Nul';
  }
  // Couleurs de texte correspondantes pour le label
  const textColor = share >= 20 ? 'text-emerald-700 bg-emerald-50'
    : share >= 10 ? 'text-emerald-600 bg-emerald-50'
    : share >= 5 ? 'text-amber-600 bg-amber-50'
    : share > 0 ? 'text-orange-600 bg-orange-50'
    : 'text-red-600 bg-red-50';

  return (
    <div className="flex items-center gap-1.5 justify-center" title={`Part d'impressions : ${share.toFixed(1)}%`}>
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${textColor}`}>{label}</span>
    </div>
  );
}

// ── Demand Level Badge ──
// Indicateur de demande basé sur le nombre d'impressions sur la période
function DemandBadge({ impressions, periodDays }: { impressions: number; periodDays: number }) {
  // Normaliser les impressions par jour pour comparer
  const dailyImpr = periodDays > 0 ? impressions / periodDays : impressions;
  let color: string;
  let label: string;
  if (dailyImpr >= 500) {
    color = 'text-emerald-600 bg-emerald-50';
    label = 'Forte';
  } else if (dailyImpr >= 100) {
    color = 'text-blue-600 bg-blue-50';
    label = 'Bonne';
  } else if (dailyImpr >= 20) {
    color = 'text-amber-600 bg-amber-50';
    label = 'Modérée';
  } else if (dailyImpr > 0) {
    color = 'text-orange-600 bg-orange-50';
    label = 'Faible';
  } else {
    color = 'text-slate-400 bg-slate-50';
    label = 'Nulle';
  }
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}
      title={`${formatInt(impressions)} impr. sur ${periodDays}j (${Math.round(dailyImpr)}/jour)`}
    >
      {label}
    </span>
  );
}

// ── Reco Group Card (extracted from page.tsx) ──
function RecoGroupCard({
  group,
  handlers,
  safetyBlocked,
  safetyMessage,
}: {
  group: RecommendationGroup;
  handlers: RecoHandlers;
  safetyBlocked: boolean;
  safetyMessage?: string;
}) {
  const [showAlternatives, setShowAlternatives] = useState(false);
  const hasAlternatives = group.alternatives.length > 0;

  return (
    <div>
      {group.recommended && (
        <RecommendationCard
          recommendation={group.recommended}
          onSimulate={handlers.onSimulate}
          onApply={handlers.onApply}
          onReject={handlers.onReject}
          safetyBlocked={safetyBlocked}
          safetyMessage={safetyMessage}
        />
      )}

      {hasAlternatives && (
        <div className="ml-4 mt-1">
          <button
            type="button"
            onClick={() => setShowAlternatives(!showAlternatives)}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors py-1"
          >
            {showAlternatives
              ? `▾ Masquer ${group.alternatives.length} autre${group.alternatives.length > 1 ? 's' : ''} option${group.alternatives.length > 1 ? 's' : ''}`
              : `▸ Voir ${group.alternatives.length} autre${group.alternatives.length > 1 ? 's' : ''} option${group.alternatives.length > 1 ? 's' : ''}`
            }
          </button>

          {showAlternatives && (
            <div className="space-y-3 mt-2 pl-3 border-l-2 border-slate-200">
              {group.alternatives.map((alt) => (
                <RecommendationCard
                  key={alt.id}
                  recommendation={alt}
                  onSimulate={handlers.onSimulate}
                  onApply={handlers.onApply}
                  onReject={handlers.onReject}
                  safetyBlocked={safetyBlocked}
                  safetyMessage={safetyMessage}
                  isAlternative
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helper: override stale recommendation metrics AND regenerate texts ──
function overrideGroupMetrics(
  groups: RecommendationGroup[],
  freshMetrics: TargetMetrics,
  lifecyclePhase?: 'launch' | 'scale' | 'evergreen' | 'relaunch',
  periodDays?: number,
): RecommendationGroup[] {
  const fresh = {
    spend: freshMetrics.spend,
    sales: freshMetrics.sales,
    clicks: freshMetrics.clicks,
    orders: freshMetrics.orders,
    impressions: freshMetrics.impressions,
    acos: freshMetrics.acos,
    ctr: freshMetrics.ctr,
    cvr: freshMetrics.cvr,
  };
  return groups.map((g) => ({
    ...g,
    recommended: g.recommended
      ? refreshRecommendationTexts(g.recommended, fresh, lifecyclePhase, periodDays)
      : null,
    alternatives: g.alternatives.map((alt) =>
      refreshRecommendationTexts(alt, fresh, lifecyclePhase, periodDays),
    ),
  }));
}

// ── Period selector pills ──
const PERIOD_OPTIONS = [
  { value: 1, label: "Aujourd'hui" },
  { value: 7, label: '7j' },
  { value: 14, label: '14j' },
  { value: 30, label: '30j' },
  { value: 60, label: '60j' },
];

function PeriodSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400">Période :</span>
      {PERIOD_OPTIONS.map((d) => (
        <button
          key={d.value}
          onClick={() => onChange(d.value)}
          className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
            value === d.value
              ? 'bg-brand-600 text-white'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

// ── Recommendations Modal ──
function RecommendationsModal({
  open,
  onClose,
  entityName,
  entityAmazonId,
  entityType,
  recoGroups,
  freshMetrics,
  parentDays,
  bookId,
  handlers,
  safetyBlocked,
  safetyMessage,
  lifecyclePhase,
}: {
  open: boolean;
  onClose: () => void;
  entityName: string;
  entityAmazonId: string;
  entityType: 'keyword' | 'target';
  recoGroups: RecommendationGroup[];
  freshMetrics: TargetMetrics | null;
  parentDays: number;
  bookId: string;
  handlers: RecoHandlers;
  safetyBlocked: boolean;
  safetyMessage?: string;
  lifecyclePhase?: 'launch' | 'scale' | 'evergreen' | 'relaunch';
}) {
  const [modalDays, setModalDays] = useState(parentDays);
  const [currentMetrics, setCurrentMetrics] = useState<TargetMetrics | null>(freshMetrics);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Reset state when modal opens with new entity
  useEffect(() => {
    if (open) {
      setModalDays(parentDays);
      setCurrentMetrics(freshMetrics);
    }
  }, [open, entityAmazonId, parentDays, freshMetrics]);

  // Fetch metrics for a different period
  const handlePeriodChange = useCallback(async (newDays: number) => {
    setModalDays(newDays);
    if (newDays === parentDays) {
      // Use the already-fetched metrics
      setCurrentMetrics(freshMetrics);
      return;
    }
    setMetricsLoading(true);
    try {
      const data = await fetchBookCampaignDetails(bookId, newDays);
      // Find the entity in the campaign details
      let foundMetrics: TargetMetrics | null = null;
      for (const camp of data.campaigns || []) {
        if (entityType === 'keyword') {
          const kw = (camp.keywords || []).find(
            (k: any) => String(k.amazonKeywordId) === entityAmazonId,
          );
          if (kw) { foundMetrics = kw.metrics; break; }
        } else {
          const tg = (camp.productTargets || []).find(
            (t: any) => String(t.amazonTargetId) === entityAmazonId,
          );
          if (tg) { foundMetrics = tg.metrics; break; }
        }
      }
      setCurrentMetrics(foundMetrics);
    } catch {
      // Keep current metrics on error
    } finally {
      setMetricsLoading(false);
    }
  }, [bookId, entityAmazonId, entityType, parentDays, freshMetrics]);

  // Replace stale snapshot metrics with fresh ones from campaign details
  const displayGroups = currentMetrics
    ? overrideGroupMetrics(recoGroups, currentMetrics, lifecyclePhase, modalDays)
    : recoGroups;

  return (
    <Modal open={open} onClose={onClose} title={`Recommandations pour « ${entityName} »`} wide>
      {/* Period selector */}
      <div className="mb-4 flex items-center justify-between">
        <PeriodSelector value={modalDays} onChange={handlePeriodChange} />
      </div>

      {/* Info banner — analysis period */}
      <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg">
        <p className="text-xs text-blue-700">
          Les conseils ci-dessous sont basés sur les résultats de ce {entityType === 'keyword' ? 'mot-clé' : 'ciblage'}{' '}
          <span className="font-semibold">
            {modalDays === 1 ? "aujourd'hui" : `sur les ${modalDays} derniers jours`}
          </span>.
          {modalDays !== 14 && ' Nous recommandons d\'analyser sur 14 jours pour des conseils plus fiables.'}
        </p>
      </div>

      {/* Fresh metrics summary */}
      {currentMetrics && (
        <div className={`mb-4 p-3 bg-slate-50 rounded-lg ${metricsLoading ? 'opacity-50' : ''}`}>
          <p className="text-xs font-medium text-slate-500 mb-1.5">
            Métriques actuelles ({modalDays === 1 ? "aujourd'hui" : `${modalDays}j`})
            {metricsLoading && <span className="ml-2 text-slate-400">Chargement...</span>}
          </p>
          <MetricChips m={currentMetrics} />
        </div>
      )}

      {displayGroups.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-slate-500">Pas de conseil pour cet élément.</p>
        </div>
      ) : (
        <div className={`space-y-4 ${metricsLoading ? 'opacity-50' : ''}`}>
          {displayGroups.map((group) => (
            <RecoGroupCard
              key={group.entityKey}
              group={group}
              handlers={handlers}
              safetyBlocked={safetyBlocked}
              safetyMessage={safetyMessage}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}

// ── Metric Mini Row ──
function MetricChips({ m }: { m: TargetMetrics }) {
  if (m.impressions === 0 && m.clicks === 0 && m.spend === 0) {
    return <span className="text-xs text-slate-300 italic">Aucune donnée</span>;
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      <span><span className="text-slate-400">Impr.</span> <span className="font-medium text-slate-700">{formatInt(m.impressions)}</span></span>
      <span><span className="text-slate-400">Clics</span> <span className="font-medium text-slate-700">{formatInt(m.clicks)}</span></span>
      <span><span className="text-slate-400">Dépensé</span> <span className="font-medium text-slate-700">{formatEur(m.spend)}</span></span>
      <span><span className="text-slate-400">Ventes</span> <span className="font-medium text-slate-700">{formatEur(m.sales)}</span></span>
      <span><span className="text-slate-400">Cmd.</span> <span className="font-medium text-slate-700">{formatInt(m.orders)}</span></span>
      {m.acos > 0 && (
        <span><span className="text-slate-400">ACoS</span> <span className={`font-medium ${m.acos > 50 ? 'text-red-600' : m.acos > 30 ? 'text-amber-600' : 'text-emerald-600'}`}>{formatPct(m.acos)}</span></span>
      )}
    </div>
  );
}

// ── Reco Badge ──
function RecoBadge({ count, onClick }: { count: number; onClick: () => void }) {
  if (count === 0) {
    return <span className="text-xs text-slate-300">—</span>;
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full text-xs font-semibold bg-brand-100 text-brand-700 hover:bg-brand-200 transition-colors cursor-pointer"
      title={`${count} conseil${count > 1 ? 's' : ''}`}
    >
      {count}
    </button>
  );
}

/**
 * Sélectionne la meilleure action pour une entité en utilisant le scoring.
 * Convertit les InsightAction rendus en ActionSuggestionItem, puis appelle selectDefaultAction.
 */
function pickBestAction(
  insight: EntityInsight | undefined,
  rendered: ReturnType<typeof renderEntityInsight> | null,
): { label: string; execution: 'ads' | 'book' | 'none'; type: string } | null {
  if (!insight || !rendered || !rendered.actions.length) return null;

  const items: ActionSuggestionItem[] = rendered.actions.map((a, i) =>
    insightActionToSuggestionItem(a, insight, i),
  );

  const best = selectDefaultAction(items, {
    diagnosisCode: insight.diagnosisCode,
    clicks: insight.summaryFacts.clicks,
  });

  if (!best) return rendered.actions[0] || null;

  // Retrouver l'action rendue correspondante
  const match = rendered.actions.find(a => a.type === best.actionType);
  return match || rendered.actions[0] || null;
}

function EntityActionBadge({ action, onClick }: { action: { label: string; execution: 'ads' | 'book' | 'none'; type: string }; onClick?: (e?: React.MouseEvent) => void }) {
  const execColors = EXECUTION_COLORS[action.execution];
  const categoryTag = action.execution === 'ads' ? '⚡' : action.execution === 'book' ? '📖' : '👁';

  if (onClick) {
    return (
      <button
        onClick={(e) => onClick(e)}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity ${execColors.bg} ${execColors.text}`}
      >
        {categoryTag} {action.label}
      </button>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${execColors.bg} ${execColors.text}`}>
      {categoryTag} {action.label}
    </span>
  );
}

// ── Keyword Table with Recommendations ──
function KeywordTableWithRecos({
  keywords,
  recommendationMap,
  handlers,
  safetyBlocked,
  safetyMessage,
  bookId,
  parentDays,
  lifecyclePhase,
  workspaceId,
  acosTarget,
  onActionExecuted,
}: {
  keywords: KeywordItem[];
  recommendationMap: Map<string, RecommendationGroup[]>;
  handlers: RecoHandlers;
  safetyBlocked: boolean;
  safetyMessage?: string;
  bookId: string;
  parentDays: number;
  lifecyclePhase?: 'launch' | 'scale' | 'evergreen' | 'relaunch';
  workspaceId?: string;
  acosTarget?: number;
  onActionExecuted?: () => void;
}) {
  const [modalKeyword, setModalKeyword] = useState<KeywordItem | null>(null);
  const [modalRecos, setModalRecos] = useState<RecommendationGroup[]>([]);
  const [actionKeyword, setActionKeyword] = useState<KeywordItem | null>(null);
  const [actionKwType, setActionKwType] = useState<'bid_up' | 'bid_down'>('bid_up');

  if (keywords.length === 0) return null;

  const openModal = (kw: KeywordItem) => {
    const entityKey = `keyword:${kw.amazonKeywordId}`;
    const recos = recommendationMap.get(entityKey) || [];
    setModalKeyword(kw);
    setModalRecos(recos);
  };

  const openBidPopover = (kw: KeywordItem, actionType: 'bid_up' | 'bid_down', _e: React.MouseEvent) => {
    setActionKeyword(kw);
    setActionKwType(actionType);
  };

  return (
    <div className="mt-3">
      <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        Mots-clés ({keywords.length})
      </h5>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-1.5 px-2 text-slate-400 font-medium">Mot-clé</th>
              <th className="text-left py-1.5 px-2 text-slate-400 font-medium">Type</th>
              <th className="text-left py-1.5 px-2 text-slate-400 font-medium">État</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Enchère</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Impr.</th>
              <th className="text-center py-1.5 px-2 text-slate-400 font-medium">Visibilité</th>
              <th className="text-center py-1.5 px-2 text-slate-400 font-medium">Demande</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Clics</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Dépensé</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium min-w-[80px]">Ventes</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Cmd.</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">ACoS</th>
              <th className="text-center py-1.5 px-2 text-slate-400 font-medium min-w-[120px]">Pourquoi ?</th>
              <th className="text-center py-1.5 px-2 text-slate-400 font-medium min-w-[110px]">Action</th>
              <th className="text-center py-1.5 px-2 text-slate-400 font-medium">Conseils</th>
            </tr>
          </thead>
          <tbody>
            {keywords.map((kw) => {
              const kwState = stateConfig[kw.state] || stateConfig.enabled;
              const entityKey = `keyword:${kw.amazonKeywordId}`;
              const recoCount = (recommendationMap.get(entityKey) || []).length;
              const kwRendered = kw.insight ? renderEntityInsight(kw.insight) : null;
              const kwTopAction = pickBestAction(kw.insight, kwRendered);
              return (
                <tr
                  key={kw.id}
                  className={`border-b border-slate-50 hover:bg-slate-50/50 ${recoCount > 0 ? 'cursor-pointer' : ''}`}
                  onClick={recoCount > 0 ? () => openModal(kw) : undefined}
                >
                  <td className="py-2 px-2 font-medium text-slate-800 max-w-[200px] truncate">
                    {kw.keywordText}
                  </td>
                  <td className="py-2 px-2">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                      {kw.matchType}
                    </span>
                  </td>
                  <td className="py-2 px-2">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${kwState.bg} ${kwState.text}`}>
                      {kwState.label}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right text-slate-600">
                    {kw.bid !== null ? `${kw.bid.toFixed(2)} €` : '—'}
                  </td>
                  <td className="py-2 px-2 text-right text-slate-600">{formatInt(kw.metrics.impressions)}</td>
                  <td className="py-2 px-2 text-center">
                    <ImpressionShareBadge share={kw.metrics.impressionShare} />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <DemandBadge impressions={kw.metrics.impressions} periodDays={parentDays} />
                  </td>
                  <td className="py-2 px-2 text-right text-slate-600">{formatInt(kw.metrics.clicks)}</td>
                  <td className="py-2 px-2 text-right text-slate-700 font-medium">{formatEur(kw.metrics.spend)}</td>
                  <td className="py-2 px-2 text-right text-slate-700 font-medium">{formatEur(kw.metrics.sales)}</td>
                  <td className="py-2 px-2 text-right text-slate-600">{formatInt(kw.metrics.orders)}</td>
                  <td className={`py-2 px-2 text-right font-medium ${
                    kw.metrics.acos > 50 ? 'text-red-600' : kw.metrics.acos > 30 ? 'text-amber-600' : kw.metrics.acos > 0 ? 'text-emerald-600' : 'text-slate-400'
                  }`}>
                    {kw.metrics.acos > 0 ? formatPct(kw.metrics.acos) : '—'}
                  </td>
                  <td className="py-2 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                    {kw.insight ? (
                      <EntityInsightPopover insight={kw.insight} entityName={kw.keywordText} />
                    ) : (
                      <span className="text-[10px] text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                    {kwTopAction ? (
                      <EntityActionBadge
                        action={kwTopAction}
                        onClick={
                          kwTopAction.execution === 'ads' && workspaceId && acosTarget != null
                            ? (e?: React.MouseEvent) => {
                                const bidActionType = kwTopAction.type === 'bid_down' ? 'bid_down' as const : 'bid_up' as const;
                                if (e) openBidPopover(kw, bidActionType, e);
                                else setActionKeyword(kw);
                              }
                            : undefined
                        }
                      />
                    ) : (
                      <span className="text-[10px] text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <RecoBadge count={recoCount} onClick={() => openModal(kw)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          {keywords.length > 1 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50/50">
                <td className="py-2 px-2 font-semibold text-slate-700" colSpan={4}>Total</td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {formatInt(keywords.reduce((s, k) => s + k.metrics.impressions, 0))}
                </td>
                <td className="py-2 px-2"></td>
                <td className="py-2 px-2"></td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {formatInt(keywords.reduce((s, k) => s + k.metrics.clicks, 0))}
                </td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {formatEur(keywords.reduce((s, k) => s + k.metrics.spend, 0))}
                </td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {formatEur(keywords.reduce((s, k) => s + k.metrics.sales, 0))}
                </td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {formatInt(keywords.reduce((s, k) => s + k.metrics.orders, 0))}
                </td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {(() => {
                    const totalSpend = keywords.reduce((s, k) => s + k.metrics.spend, 0);
                    const totalSales = keywords.reduce((s, k) => s + k.metrics.sales, 0);
                    return totalSales > 0 ? formatPct((totalSpend / totalSales) * 100) : '—';
                  })()}
                </td>
                <td className="py-2 px-2"></td>
                <td className="py-2 px-2"></td>
                <td className="py-2 px-2"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Modal for keyword recommendations */}
      {modalKeyword && (
        <RecommendationsModal
          open={!!modalKeyword}
          onClose={() => setModalKeyword(null)}
          entityName={modalKeyword.keywordText}
          entityAmazonId={modalKeyword.amazonKeywordId}
          entityType="keyword"
          recoGroups={modalRecos}
          freshMetrics={modalKeyword.metrics}
          parentDays={parentDays}
          bookId={bookId}
          handlers={handlers}
          safetyBlocked={safetyBlocked}
          safetyMessage={safetyMessage}
          lifecyclePhase={lifecyclePhase}
        />
      )}

      {/* Bid Action Popover for keyword */}
      {actionKeyword && workspaceId && acosTarget != null && (
        <BidActionPopover
          entityKey={`keyword:${actionKeyword.amazonKeywordId}`}
          entityType="keyword"
          entityName={actionKeyword.keywordText}
          currentBid={actionKeyword.bid}
          workspaceId={workspaceId}
          acosTarget={acosTarget}
          lifecyclePhase={lifecyclePhase}
          actionType={actionKwType}
          onClose={() => setActionKeyword(null)}
          onActionExecuted={onActionExecuted}
        />
      )}
    </div>
  );
}

// ── Product Target Table with Recommendations ──
function ProductTargetTableWithRecos({
  targets,
  recommendationMap,
  handlers,
  safetyBlocked,
  safetyMessage,
  bookId,
  parentDays,
  lifecyclePhase,
  workspaceId,
  acosTarget,
  onActionExecuted,
}: {
  targets: ProductTargetItem[];
  recommendationMap: Map<string, RecommendationGroup[]>;
  handlers: RecoHandlers;
  safetyBlocked: boolean;
  safetyMessage?: string;
  bookId: string;
  parentDays: number;
  lifecyclePhase?: 'launch' | 'scale' | 'evergreen' | 'relaunch';
  workspaceId?: string;
  acosTarget?: number;
  onActionExecuted?: () => void;
}) {
  const [modalTarget, setModalTarget] = useState<ProductTargetItem | null>(null);
  const [modalRecos, setModalRecos] = useState<RecommendationGroup[]>([]);
  const [actionTarget, setActionTarget] = useState<ProductTargetItem | null>(null);
  const [actionTgType, setActionTgType] = useState<'bid_up' | 'bid_down'>('bid_up');

  if (targets.length === 0) return null;

  const openModal = (tg: ProductTargetItem) => {
    const entityKey = `target:${tg.amazonTargetId}`;
    const recos = recommendationMap.get(entityKey) || [];
    setModalTarget(tg);
    setModalRecos(recos);
  };

  const openBidPopoverTg = (tg: ProductTargetItem, actionType: 'bid_up' | 'bid_down', _e: React.MouseEvent) => {
    setActionTarget(tg);
    setActionTgType(actionType);
  };

  return (
    <div className="mt-3">
      <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        Ciblage produit ({targets.length})
      </h5>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-1.5 px-2 text-slate-400 font-medium">Cible</th>
              <th className="text-left py-1.5 px-2 text-slate-400 font-medium">Type</th>
              <th className="text-left py-1.5 px-2 text-slate-400 font-medium">État</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Enchère</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Impr.</th>
              <th className="text-center py-1.5 px-2 text-slate-400 font-medium">Visibilité</th>
              <th className="text-center py-1.5 px-2 text-slate-400 font-medium">Demande</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Clics</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Dépensé</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium min-w-[80px]">Ventes</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Cmd.</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">ACoS</th>
              <th className="text-center py-1.5 px-2 text-slate-400 font-medium min-w-[120px]">Pourquoi ?</th>
              <th className="text-center py-1.5 px-2 text-slate-400 font-medium min-w-[110px]">Action</th>
              <th className="text-center py-1.5 px-2 text-slate-400 font-medium">Conseils</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((tg) => {
              const tgState = stateConfig[tg.state] || stateConfig.enabled;
              const entityKey = `target:${tg.amazonTargetId}`;
              const recoCount = (recommendationMap.get(entityKey) || []).length;
              const tgRendered = tg.insight ? renderEntityInsight(tg.insight) : null;
              const tgTopAction = pickBestAction(tg.insight, tgRendered);
              return (
                <tr
                  key={tg.id}
                  className={`border-b border-slate-50 hover:bg-slate-50/50 ${recoCount > 0 ? 'cursor-pointer' : ''}`}
                  onClick={recoCount > 0 ? () => openModal(tg) : undefined}
                >
                  <td className="py-2 px-2 font-medium text-slate-800 max-w-[200px] truncate">
                    {tg.expression}
                  </td>
                  <td className="py-2 px-2">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                      {tg.expressionType}
                    </span>
                  </td>
                  <td className="py-2 px-2">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${tgState.bg} ${tgState.text}`}>
                      {tgState.label}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right text-slate-600">
                    {tg.bid !== null ? `${tg.bid.toFixed(2)} €` : '—'}
                  </td>
                  <td className="py-2 px-2 text-right text-slate-600">{formatInt(tg.metrics.impressions)}</td>
                  <td className="py-2 px-2 text-center">
                    <ImpressionShareBadge share={tg.metrics.impressionShare} />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <DemandBadge impressions={tg.metrics.impressions} periodDays={parentDays} />
                  </td>
                  <td className="py-2 px-2 text-right text-slate-600">{formatInt(tg.metrics.clicks)}</td>
                  <td className="py-2 px-2 text-right text-slate-700 font-medium">{formatEur(tg.metrics.spend)}</td>
                  <td className="py-2 px-2 text-right text-slate-700 font-medium">{formatEur(tg.metrics.sales)}</td>
                  <td className="py-2 px-2 text-right text-slate-600">{formatInt(tg.metrics.orders)}</td>
                  <td className={`py-2 px-2 text-right font-medium ${
                    tg.metrics.acos > 50 ? 'text-red-600' : tg.metrics.acos > 30 ? 'text-amber-600' : tg.metrics.acos > 0 ? 'text-emerald-600' : 'text-slate-400'
                  }`}>
                    {tg.metrics.acos > 0 ? formatPct(tg.metrics.acos) : '—'}
                  </td>
                  <td className="py-2 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                    {tg.insight ? (
                      <EntityInsightPopover insight={tg.insight} entityName={tg.expression} />
                    ) : (
                      <span className="text-[10px] text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                    {tgTopAction ? (
                      <EntityActionBadge
                        action={tgTopAction}
                        onClick={
                          tgTopAction.execution === 'ads' && workspaceId && acosTarget != null
                            ? (e?: React.MouseEvent) => {
                                const bidActionType = tgTopAction.type === 'bid_down' ? 'bid_down' as const : 'bid_up' as const;
                                if (e) openBidPopoverTg(tg, bidActionType, e);
                                else setActionTarget(tg);
                              }
                            : undefined
                        }
                      />
                    ) : (
                      <span className="text-[10px] text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <RecoBadge count={recoCount} onClick={() => openModal(tg)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          {targets.length > 1 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50/50">
                <td className="py-2 px-2 font-semibold text-slate-700" colSpan={4}>Total</td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {formatInt(targets.reduce((s, t) => s + t.metrics.impressions, 0))}
                </td>
                <td className="py-2 px-2"></td>
                <td className="py-2 px-2"></td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {formatInt(targets.reduce((s, t) => s + t.metrics.clicks, 0))}
                </td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {formatEur(targets.reduce((s, t) => s + t.metrics.spend, 0))}
                </td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {formatEur(targets.reduce((s, t) => s + t.metrics.sales, 0))}
                </td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {formatInt(targets.reduce((s, t) => s + t.metrics.orders, 0))}
                </td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {(() => {
                    const totalSpend = targets.reduce((s, t) => s + t.metrics.spend, 0);
                    const totalSales = targets.reduce((s, t) => s + t.metrics.sales, 0);
                    return totalSales > 0 ? formatPct((totalSpend / totalSales) * 100) : '—';
                  })()}
                </td>
                <td className="py-2 px-2"></td>
                <td className="py-2 px-2"></td>
                <td className="py-2 px-2"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {modalTarget && (
        <RecommendationsModal
          open={!!modalTarget}
          onClose={() => setModalTarget(null)}
          entityName={modalTarget.expression}
          entityAmazonId={modalTarget.amazonTargetId}
          entityType="target"
          recoGroups={modalRecos}
          freshMetrics={modalTarget.metrics}
          parentDays={parentDays}
          bookId={bookId}
          handlers={handlers}
          safetyBlocked={safetyBlocked}
          safetyMessage={safetyMessage}
          lifecyclePhase={lifecyclePhase}
        />
      )}

      {/* Bid Action Popover for target */}
      {actionTarget && workspaceId && acosTarget != null && (
        <BidActionPopover
          entityKey={`target:${actionTarget.amazonTargetId}`}
          entityType="target"
          entityName={actionTarget.expression}
          currentBid={actionTarget.bid}
          workspaceId={workspaceId}
          acosTarget={acosTarget}
          lifecyclePhase={lifecyclePhase}
          actionType={actionTgType}
          onClose={() => setActionTarget(null)}
          onActionExecuted={onActionExecuted}
        />
      )}
    </div>
  );
}

// ── Campaign Card ──
function OverviewCampaignCard({
  campaign,
  recommendationMap,
  handlers,
  safetyBlocked,
  safetyMessage,
  bookId,
  parentDays,
  lifecyclePhase,
  workspaceId,
  acosTarget,
  onActionExecuted,
}: {
  campaign: CampaignDetail;
  recommendationMap: Map<string, RecommendationGroup[]>;
  handlers: RecoHandlers;
  safetyBlocked: boolean;
  safetyMessage?: string;
  bookId: string;
  parentDays: number;
  lifecyclePhase?: 'launch' | 'scale' | 'evergreen' | 'relaunch';
  workspaceId?: string;
  acosTarget?: number;
  onActionExecuted?: () => void;
}) {
  const [expanded, setExpanded] = useState(campaign.state === 'enabled');
  const sc = stateConfig[campaign.state] || stateConfig.enabled;
  const typeLabel = typeLabels[campaign.campaignType] || campaign.campaignType;

  const hasKeywords = campaign.keywords.length > 0;
  const hasTargets = campaign.productTargets.length > 0;
  const hasData = hasKeywords || hasTargets;

  // Count total recommendations for this campaign
  let totalRecos = 0;
  for (const kw of campaign.keywords) {
    const entityKey = `keyword:${kw.amazonKeywordId}`;
    totalRecos += (recommendationMap.get(entityKey) || []).length;
  }
  for (const tg of campaign.productTargets) {
    const entityKey = `target:${tg.amazonTargetId}`;
    totalRecos += (recommendationMap.get(entityKey) || []).length;
  }

  return (
    <Card className={`border-l-4 ${totalRecos > 0 ? 'border-l-brand-400' : 'border-l-slate-300'}`}>
      <CardContent>
        {/* Header */}
        <div
          className="flex items-start justify-between cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}>
                {sc.label}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
                {typeLabel}
              </span>
              {campaign.targetingType && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                  {campaign.targetingType === 'manual' ? 'Manuel' : 'Auto'}
                </span>
              )}
              {campaign.isPrimary && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-600">
                  Principale
                </span>
              )}
              {totalRecos > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-100 text-brand-700">
                  {totalRecos} conseil{totalRecos > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <h4 className="text-sm font-semibold text-slate-900 mt-1.5 truncate">
              {campaign.name}
            </h4>
            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
              {campaign.dailyBudget !== null && (
                <span>Budget : {campaign.dailyBudget.toFixed(2)} €/jour</span>
              )}
              {campaign.biddingStrategy && (
                <span>Stratégie : {campaign.biddingStrategy}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="ml-3 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0 mt-1"
          >
            {expanded ? '▾' : '▸'}
          </button>
        </div>

        {/* Campaign-level metrics summary */}
        <div className="mt-3 p-2.5 bg-slate-50 rounded-lg">
          <MetricChips m={campaign.metrics} />
        </div>

        {/* Campaign insight */}
        {campaign.insight && (
          <CampaignInsightCard insight={campaign.insight} />
        )}

        {/* Expanded content */}
        {expanded && hasData && (
          <div className="mt-4 space-y-4">
            {hasKeywords && (
              <KeywordTableWithRecos
                keywords={campaign.keywords}
                recommendationMap={recommendationMap}
                handlers={handlers}
                safetyBlocked={safetyBlocked}
                safetyMessage={safetyMessage}
                bookId={bookId}
                parentDays={parentDays}
                lifecyclePhase={lifecyclePhase}
                workspaceId={workspaceId}
                acosTarget={acosTarget}
                onActionExecuted={onActionExecuted}
              />
            )}
            {hasTargets && (
              <ProductTargetTableWithRecos
                targets={campaign.productTargets}
                recommendationMap={recommendationMap}
                handlers={handlers}
                safetyBlocked={safetyBlocked}
                safetyMessage={safetyMessage}
                bookId={bookId}
                parentDays={parentDays}
                lifecyclePhase={lifecyclePhase}
                workspaceId={workspaceId}
                acosTarget={acosTarget}
                onActionExecuted={onActionExecuted}
              />
            )}
          </div>
        )}

        {expanded && !hasData && (
          <div className="mt-4 text-center py-3">
            <p className="text-xs text-slate-400">
              {campaign.targetingType === 'auto'
                ? 'Campagne automatique — les ciblages sont gérés par Amazon.'
                : 'Aucun mot-clé ou ciblage produit trouvé pour cette campagne.'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Component ──
export function OverviewCampaignView({
  bookId,
  campaignDetails,
  recommendationMap,
  handlers,
  safetyBlocked,
  safetyMessage,
  days,
  onDaysChange,
  loading,
  lifecyclePhase,
  workspaceId,
  acosTarget,
  onActionExecuted,
}: OverviewCampaignViewProps) {

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-32 bg-slate-100 animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }

  if (!campaignDetails || campaignDetails.campaigns.length === 0) {
    return (
      <Card>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-sm text-slate-500">
              Aucune campagne associée à ce livre. Lie des campagnes depuis la page d&apos;accueil.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sort campaigns: manual first, then auto, then by name (stable order across period changes)
  const sortedCampaigns = [...campaignDetails.campaigns].sort((a, b) => {
    // manual targeting first
    if (a.targetingType === 'manual' && b.targetingType !== 'manual') return -1;
    if (a.targetingType !== 'manual' && b.targetingType === 'manual') return 1;
    // then alphabetically by name (stable across period changes)
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Campagnes ({campaignDetails.campaigns.length})
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Période :</span>
          {[
            { value: 1, label: "Aujourd'hui" },
            { value: 7, label: '7j' },
            { value: 14, label: '14j' },
            { value: 30, label: '30j' },
            { value: 60, label: '60j' },
          ].map((d) => (
            <button
              key={d.value}
              onClick={() => onDaysChange(d.value)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                days === d.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Campaign cards */}
      {sortedCampaigns.map((campaign) => (
        <OverviewCampaignCard
          key={campaign.id}
          campaign={campaign}
          recommendationMap={recommendationMap}
          handlers={handlers}
          safetyBlocked={safetyBlocked}
          safetyMessage={safetyMessage}
          bookId={bookId}
          parentDays={days}
          lifecyclePhase={lifecyclePhase}
          workspaceId={workspaceId}
          acosTarget={acosTarget}
          onActionExecuted={onActionExecuted}
        />
      ))}
    </div>
  );
}
