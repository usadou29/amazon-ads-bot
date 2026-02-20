'use client';
import React from 'react';
import { HumanMetric } from '@/lib/transforms/metrics';
interface MetricCardProps { metric: HumanMetric; compact?: boolean; }
export function MetricCard({ metric, compact = false }: MetricCardProps) {
  const trendColor = metric.trendDirection === 'up' ? 'text-emerald-600' : metric.trendDirection === 'down' ? 'text-red-600' : 'text-slate-400';
  if (compact) {
    return (<div className="flex items-baseline justify-between"><span className="text-xs text-slate-500">{metric.label}</span><div className="flex items-baseline gap-1"><span className="text-sm font-semibold text-slate-900">{metric.value}</span>{metric.trend && <span className={`text-xs font-medium ${trendColor}`}>{metric.trend}</span>}</div></div>);
  }
  return (<div className="bg-white rounded-lg p-3 border border-slate-200"><p className="text-xs text-slate-500 mb-1">{metric.label}</p><div className="flex items-baseline gap-2"><span className="text-xl font-bold text-slate-900">{metric.value}</span>{metric.trend && <span className={`text-sm font-medium ${trendColor}`}>{metric.trend}</span>}</div>{metric.description && <p className="text-xs text-slate-400 mt-1">{metric.description}</p>}</div>);
}
export function MetricsGrid({ metrics }: { metrics: HumanMetric[] }) {
  return (<div className="grid grid-cols-2 md:grid-cols-4 gap-3">{metrics.map((m) => <MetricCard key={m.label} metric={m} />)}</div>);
}
