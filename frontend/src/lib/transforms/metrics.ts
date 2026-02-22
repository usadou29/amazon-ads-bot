export interface HumanMetric {
  label: string;
  value: string;
  trend?: string;
  trendDirection?: 'up' | 'down' | 'flat';
  description?: string;
}

export function formatCurrency(value: number): string {
  return `${value.toFixed(2)} €`;
}

export function formatCurrencyShort(value: number): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k €`;
  return `${value.toFixed(0)}€`;
}

export function formatNumber(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toString();
}

export function formatPercent(value: number | null): string {
  return value !== null ? `${value.toFixed(1)}%` : '—';
}

function formatTrend(change: number | null): { text: string; dir: 'up' | 'down' | 'flat' } | null {
  if (change === null || change === undefined) return null;
  const dir = change > 1 ? 'up' : change < -1 ? 'down' : 'flat';
  return { text: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`, dir };
}

/**
 * KPIs complets (pour page détail livre)
 * Termes simplifiés, pas de jargon Amazon Ads
 */
export function transformKPIs(raw: any, changes?: Record<string, number | null>): HumanMetric[] {
  const c = changes || {};
  const items: { key: string; label: string; format: (v: any) => string }[] = [
    { key: 'spend', label: 'Dépenses pub', format: formatCurrency },
    { key: 'sales', label: 'Ventes générées', format: formatCurrency },
    { key: 'acos', label: 'Efficacité pub', format: (v) => v !== null ? `${Math.max(0, 100 - v).toFixed(1)}%` : '—' },
    { key: 'roas', label: 'Retour sur invest.', format: (v) => v !== null ? `×${v.toFixed(2)}` : '—' },
    { key: 'impressions', label: 'Personnes touchées', format: formatNumber },
    { key: 'clicks', label: 'Clics vers ton livre', format: formatNumber },
    { key: 'orders', label: 'Ventes', format: formatNumber },
    { key: 'ctr', label: 'Taux d\'intérêt', format: formatPercent },
  ];
  // Keys where lower raw value = better → invert trend direction
  const invertedKeys = new Set(['acos']);
  return items.filter((i) => raw[i.key] !== undefined).map((item) => {
    const rawChange = c[item.key] ?? null;
    const trendChange = invertedKeys.has(item.key) && rawChange !== null ? -rawChange : rawChange;
    const trend = formatTrend(trendChange);
    return { label: item.label, value: item.format(raw[item.key]), trend: trend?.text, trendDirection: trend?.dir };
  });
}

/**
 * Calcule le revenu réel d'un auteur à partir des ventes Amazon
 * - Si royaltyRate est défini (ex: 35 ou 70), on calcule : sales × rate / 100
 * - Sinon, on estime à 25% (diviser par 4)
 */
export const DEFAULT_ROYALTY_RATE = 25;

export function computeRevenue(sales: number, royaltyRate?: number | null): number {
  const rate = royaltyRate && royaltyRate > 0 ? royaltyRate : DEFAULT_ROYALTY_RATE;
  return sales * rate / 100;
}

export function computeProfit(sales: number, spend: number, royaltyRate?: number | null): number {
  return computeRevenue(sales, royaltyRate) - spend;
}

/**
 * KPIs simplifiés pour la carte livre (accueil)
 * Seulement 3 métriques essentielles: profit, ventes, dépenses
 */
export function transformBookCardKPIs(raw: any, royaltyRate?: number | null): {
  profit: number;
  profitFormatted: string;
  revenue: number;
  revenueFormatted: string;
  sales: number;
  salesFormatted: string;
  spend: number;
  spendFormatted: string;
  orders: number;
  royaltyRate: number;
  isEstimated: boolean;
} {
  const sales = Number(raw?.sales || 0);
  const spend = Number(raw?.spend || 0);
  const rate = royaltyRate && royaltyRate > 0 ? royaltyRate : DEFAULT_ROYALTY_RATE;
  const isEstimated = !royaltyRate || royaltyRate <= 0;
  const revenue = computeRevenue(sales, royaltyRate);
  const profit = revenue - spend;
  return {
    profit,
    profitFormatted: `${profit >= 0 ? '+' : ''}${profit.toFixed(0)}€`,
    revenue,
    revenueFormatted: formatCurrency(revenue),
    sales,
    salesFormatted: formatCurrency(sales),
    spend,
    spendFormatted: formatCurrency(spend),
    orders: Number(raw?.orders || 0),
    royaltyRate: rate,
    isEstimated,
  };
}

/**
 * Résumé en langage naturel — ton assistant, pas analyste
 * Utilise la redevance pour calculer les vrais gains
 */
export function generateVerbalSummary(kpis: HumanMetric[], bookTitle: string, royaltyRate?: number | null): string {
  const spend = kpis.find((k) => k.label === 'Dépenses pub');
  const sales = kpis.find((k) => k.label === 'Ventes générées');

  const spendVal = parseFloat(spend?.value || '0');
  const salesVal = parseFloat(sales?.value || '0');
  const revenue = computeRevenue(salesVal, royaltyRate);
  const profit = revenue - spendVal;
  const rate = royaltyRate && royaltyRate > 0 ? royaltyRate : DEFAULT_ROYALTY_RATE;
  const isEstimated = !royaltyRate || royaltyRate <= 0;
  const estimateNote = isEstimated ? ' (estimation à 25%)' : '';

  if (spendVal === 0 && salesVal === 0) {
    return `Pas encore de données pour "${bookTitle}". Lance une synchronisation ou attends que les pubs tournent.`;
  }

  if (profit > 0) {
    return `Bonne nouvelle ! "${bookTitle}" te rapporte environ ${profit.toFixed(0)}€ de gains réels ce mois-ci${estimateNote}. Tu as dépensé ${spend?.value || '—'} en pub et tu touches ${formatCurrency(revenue)} de redevances (${rate}% sur ${sales?.value || '—'} de ventes Amazon).`;
  }

  if (profit === 0) {
    return `"${bookTitle}" est à l'équilibre ce mois-ci${estimateNote} : ${spend?.value || '—'} dépensés en pub, ${formatCurrency(revenue)} de redevances. On peut optimiser ça.`;
  }

  return `Attention, "${bookTitle}" te coûte ${Math.abs(profit).toFixed(0)}€ ce mois-ci${estimateNote}. Tu as dépensé ${spend?.value || '—'} en pub pour ${formatCurrency(revenue)} de redevances (${rate}% sur ${sales?.value || '—'} de ventes Amazon). On va arranger ça.`;
}

// ═══════════════════════════════════════════════════════════════
// Indice de dépendance publicitaire
// Score pédagogique basé uniquement sur les métriques Ads.
// Pas un indicateur financier. N'influence aucune règle métier.
// ═══════════════════════════════════════════════════════════════

export interface AdsDependencyInfo {
  /** Score 0-100 calculé côté backend. -1 = pas de données */
  score: number;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  emoji: string;
  explanation: string;
}

/**
 * Interprète le score de dépendance publicitaire (0-100)
 * calculé côté backend à partir des métriques Ads uniquement.
 *
 * Score élevé = le livre dépend beaucoup de la pub.
 * Score bas = le livre montre des signes de référencement organique.
 *
 * Cet indicateur n'est PAS un indicateur financier.
 * Il ne doit influencer aucune règle métier automatique.
 */
export function interpretAdsDependency(score: number): AdsDependencyInfo {
  if (score < 0) {
    return {
      score,
      label: 'Pas encore de données',
      color: 'text-slate-400',
      bgColor: 'bg-slate-50',
      borderColor: 'border-slate-200',
      emoji: '🔘',
      explanation: 'Lance tes premières campagnes pour voir apparaître cet indicateur.',
    };
  }

  if (score <= 25) {
    return {
      score,
      label: 'Se vend naturellement',
      color: 'text-emerald-700',
      bgColor: 'bg-emerald-50',
      borderColor: 'border-emerald-200',
      emoji: '🟢',
      explanation: 'Ton livre a de bons signaux de référencement. Les gens qui voient ta pub cliquent et achètent facilement. C\'est signe que le livre plaît et se positionne bien sur Amazon.',
    };
  }

  if (score <= 45) {
    return {
      score,
      label: 'Commence à se référencer',
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
      borderColor: 'border-emerald-200',
      emoji: '🔵',
      explanation: 'Ton livre montre des signes positifs : bon taux de clic et de conversion. La pub aide à construire ton référencement. Continue comme ça.',
    };
  }

  if (score <= 65) {
    return {
      score,
      label: 'Dépend encore de la publicité',
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-200',
      emoji: '🟡',
      explanation: 'Ton livre a besoin de la pub pour générer des ventes. C\'est normal en phase de lancement. Concentre-toi sur les mots-clés qui convertissent bien pour accélérer le référencement.',
    };
  }

  if (score <= 85) {
    return {
      score,
      label: 'Très dépendant de la publicité',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      borderColor: 'border-orange-200',
      emoji: '🟠',
      explanation: 'Sans pub, ton livre aurait peu de visibilité. Ça peut être normal au début. Vérifie que tes mots-clés sont pertinents et que ta page produit (couverture, description) donne envie.',
    };
  }

  return {
    score,
    label: 'Dépend totalement de la publicité',
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    emoji: '🔴',
    explanation: 'Ton livre peine à convertir via la pub. Ça peut venir de plusieurs choses : mots-clés mal ciblés, couverture qui attire peu, prix mal positionné, ou description à retravailler. Avant d\'investir plus, optimise ta page produit.',
  };
}
