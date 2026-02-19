export interface HumanMetric {
  label: string;
  value: string;
  trend?: string;
  trendDirection?: 'up' | 'down' | 'flat';
  description?: string;
}

export function formatCurrency(value: number): string { return `${value.toFixed(2)} €`; }
export function formatNumber(value: number): string { return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toString(); }
export function formatPercent(value: number | null): string { return value !== null ? `${value.toFixed(1)}%` : '—'; }
function formatTrend(change: number | null): { text: string; dir: 'up' | 'down' | 'flat' } | null {
  if (change === null || change === undefined) return null;
  const dir = change > 1 ? 'up' : change < -1 ? 'down' : 'flat';
  return { text: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`, dir };
}

export function transformKPIs(raw: any, changes?: Record<string, number | null>): HumanMetric[] {
  const c = changes || {};
  const items: { key: string; label: string; format: (v: any) => string }[] = [
    { key: 'spend', label: 'Dépenses pub', format: formatCurrency },
    { key: 'sales', label: 'Ventes', format: formatCurrency },
    { key: 'acos', label: 'Ratio dépense-ventes', format: formatPercent },
    { key: 'roas', label: 'Retour sur invest.', format: (v) => v !== null ? `×${v.toFixed(2)}` : '—' },
    { key: 'impressions', label: 'Affichages', format: formatNumber },
    { key: 'clicks', label: 'Clics', format: formatNumber },
    { key: 'orders', label: 'Commandes', format: formatNumber },
    { key: 'ctr', label: 'Taux de clic', format: formatPercent },
  ];
  return items.filter((i) => raw[i.key] !== undefined).map((item) => {
    const trend = formatTrend(c[item.key] ?? null);
    return { label: item.label, value: item.format(raw[item.key]), trend: trend?.text, trendDirection: trend?.dir };
  });
}

export function generateVerbalSummary(kpis: HumanMetric[], bookTitle: string): string {
  const spend = kpis.find((k) => k.label === 'Dépenses pub');
  const sales = kpis.find((k) => k.label === 'Ventes');
  const acos = kpis.find((k) => k.label === 'Ratio dépense-ventes');
  return `Sur les 30 derniers jours, "${bookTitle}" a généré ${sales?.value || '—'} de ventes pour ${spend?.value || '—'} de dépenses publicitaires, soit un ratio dépense-ventes de ${acos?.value || '—'}.`;
}
