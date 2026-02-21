'use client';
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
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
}

interface KeywordItem {
  id: string;
  keywordText: string;
  matchType: string;
  matchTypeRaw: string;
  state: string;
  bid: number | null;
  metrics: TargetMetrics;
}

interface ProductTargetItem {
  id: string;
  expressionType: string;
  expression: string;
  state: string;
  bid: number | null;
  metrics: TargetMetrics;
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
}

interface CampaignDetailsResponse {
  campaigns: CampaignDetail[];
  periodDays: number;
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

// ── Keyword Table ──
function KeywordTable({ keywords }: { keywords: KeywordItem[] }) {
  if (keywords.length === 0) return null;

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
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Clics</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Dépensé</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Ventes</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Cmd.</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">ACoS</th>
            </tr>
          </thead>
          <tbody>
            {keywords.map((kw) => {
              const kwState = stateConfig[kw.state] || stateConfig.enabled;
              return (
                <tr key={kw.id} className="border-b border-slate-50 hover:bg-slate-50/50">
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
                  <td className="py-2 px-2 text-right text-slate-600">{formatInt(kw.metrics.clicks)}</td>
                  <td className="py-2 px-2 text-right text-slate-700 font-medium">{formatEur(kw.metrics.spend)}</td>
                  <td className="py-2 px-2 text-right text-slate-700 font-medium">{formatEur(kw.metrics.sales)}</td>
                  <td className="py-2 px-2 text-right text-slate-600">{formatInt(kw.metrics.orders)}</td>
                  <td className={`py-2 px-2 text-right font-medium ${
                    kw.metrics.acos > 50 ? 'text-red-600' : kw.metrics.acos > 30 ? 'text-amber-600' : kw.metrics.acos > 0 ? 'text-emerald-600' : 'text-slate-400'
                  }`}>
                    {kw.metrics.acos > 0 ? formatPct(kw.metrics.acos) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Total row */}
          {keywords.length > 1 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50/50">
                <td className="py-2 px-2 font-semibold text-slate-700" colSpan={4}>Total</td>
                <td className="py-2 px-2 text-right font-semibold text-slate-700">
                  {formatInt(keywords.reduce((s, k) => s + k.metrics.impressions, 0))}
                </td>
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
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Product Targets Table ──
function ProductTargetTable({ targets }: { targets: ProductTargetItem[] }) {
  if (targets.length === 0) return null;

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
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Clics</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Dépensé</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Ventes</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">Cmd.</th>
              <th className="text-right py-1.5 px-2 text-slate-400 font-medium">ACoS</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((tg) => {
              const tgState = stateConfig[tg.state] || stateConfig.enabled;
              return (
                <tr key={tg.id} className="border-b border-slate-50 hover:bg-slate-50/50">
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
                  <td className="py-2 px-2 text-right text-slate-600">{formatInt(tg.metrics.clicks)}</td>
                  <td className="py-2 px-2 text-right text-slate-700 font-medium">{formatEur(tg.metrics.spend)}</td>
                  <td className="py-2 px-2 text-right text-slate-700 font-medium">{formatEur(tg.metrics.sales)}</td>
                  <td className="py-2 px-2 text-right text-slate-600">{formatInt(tg.metrics.orders)}</td>
                  <td className={`py-2 px-2 text-right font-medium ${
                    tg.metrics.acos > 50 ? 'text-red-600' : tg.metrics.acos > 30 ? 'text-amber-600' : tg.metrics.acos > 0 ? 'text-emerald-600' : 'text-slate-400'
                  }`}>
                    {tg.metrics.acos > 0 ? formatPct(tg.metrics.acos) : '—'}
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
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Campaign Card ──
function CampaignCard({ campaign }: { campaign: CampaignDetail }) {
  const [expanded, setExpanded] = useState(true);
  const sc = stateConfig[campaign.state] || stateConfig.enabled;
  const typeLabel = typeLabels[campaign.campaignType] || campaign.campaignType;

  const hasKeywords = campaign.keywords.length > 0;
  const hasTargets = campaign.productTargets.length > 0;
  const hasData = hasKeywords || hasTargets;

  return (
    <Card className="border-l-4 border-l-brand-400">
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

        {/* Expanded content */}
        {expanded && hasData && (
          <div className="mt-4 space-y-4">
            {hasKeywords && <KeywordTable keywords={campaign.keywords} />}
            {hasTargets && <ProductTargetTable targets={campaign.productTargets} />}
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
interface CampaignDetailViewProps {
  bookId: string;
  syncCompletedCount?: number;
}

export function CampaignDetailView({ bookId, syncCompletedCount }: CampaignDetailViewProps) {
  const [data, setData] = useState<CampaignDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (!bookId) return;
    setLoading(true);
    setError(null);
    fetchBookCampaignDetails(bookId, days)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [bookId, days, syncCompletedCount]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-32 bg-slate-100 animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-red-600">Erreur lors du chargement des campagnes</p>
        <p className="text-xs text-slate-400 mt-1">{error}</p>
      </div>
    );
  }

  if (!data || data.campaigns.length === 0) {
    return (
      <Card>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-sm text-slate-500">
              Aucune campagne associée à ce livre. Lie des campagnes depuis la page d'accueil.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Campagnes ({data.campaigns.length})
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Période :</span>
          {[7, 14, 30, 60].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                days === d
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {d}j
            </button>
          ))}
        </div>
      </div>

      {/* Campaign cards */}
      {data.campaigns.map((campaign) => (
        <CampaignCard key={campaign.id} campaign={campaign} />
      ))}
    </div>
  );
}
