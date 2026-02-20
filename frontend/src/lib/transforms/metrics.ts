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
    { key: 'acos', label: 'Efficacité pub', format: (v) => v !== null ? `${v.toFixed(1)}%` : '—' },
    { key: 'roas', label: 'Retour sur invest.', format: (v) => v !== null ? `×${v.toFixed(2)}` : '—' },
    { key: 'impressions', label: 'Personnes touchées', format: formatNumber },
    { key: 'clicks', label: 'Clics vers ton livre', format: formatNumber },
    { key: 'orders', label: 'Ventes', format: formatNumber },
    { key: 'ctr', label: 'Taux d\'intérêt', format: formatPercent },
  ];
  return items.filter((i) => raw[i.key] !== undefined).map((item) => {
    const trend = formatTrend(c[item.key] ?? null);
    return { label: item.label, value: item.format(raw[item.key]), trend: trend?.text, trendDirection: trend?.dir };
  });
}

/**
 * KPIs simplifiés pour la carte livre (accueil)
 * Seulement 3 métriques essentielles: profit, ventes, dépenses
 */
export function transformBookCardKPIs(raw: any): {
  profit: number;
  profitFormatted: string;
  sales: number;
  salesFormatted: string;
  spend: number;
  spendFormatted: string;
  orders: number;
} {
  const sales = Number(raw?.sales || 0);
  const spend = Number(raw?.spend || 0);
  const profit = sales - spend;
  return {
    profit,
    profitFormatted: `${profit >= 0 ? '+' : ''}${profit.toFixed(0)}€`,
    sales,
    salesFormatted: formatCurrency(sales),
    spend,
    spendFormatted: formatCurrency(spend),
    orders: Number(raw?.orders || 0),
  };
}

/**
 * Résumé en langage naturel — ton assistant, pas analyste
 */
export function generateVerbalSummary(kpis: HumanMetric[], bookTitle: string): string {
  const spend = kpis.find((k) => k.label === 'Dépenses pub');
  const sales = kpis.find((k) => k.label === 'Ventes générées');

  const spendVal = parseFloat(spend?.value || '0');
  const salesVal = parseFloat(sales?.value || '0');
  const profit = salesVal - spendVal;

  if (spendVal === 0 && salesVal === 0) {
    return `Pas encore de données pour "${bookTitle}". Lance une synchronisation ou attends que les pubs tournent.`;
  }

  if (profit > 0) {
    return `Bonne nouvelle ! "${bookTitle}" te rapporte ${profit.toFixed(0)}€ de profit pub ce mois-ci. Tu as dépensé ${spend?.value || '—'} en pub et généré ${sales?.value || '—'} de ventes.`;
  }

  if (profit === 0) {
    return `"${bookTitle}" est à l'équilibre ce mois-ci : ${spend?.value || '—'} dépensés, ${sales?.value || '—'} générés. On peut optimiser ça.`;
  }

  return `Attention, "${bookTitle}" te coûte ${Math.abs(profit).toFixed(0)}€ ce mois-ci. Tu as dépensé ${spend?.value || '—'} en pub pour ${sales?.value || '—'} de ventes. On va arranger ça.`;
}
