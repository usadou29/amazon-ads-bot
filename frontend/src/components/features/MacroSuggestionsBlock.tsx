'use client';

import { useState } from 'react';
import { MacroActionModal } from './MacroActionModal';

// ── Types ──────────────────────────────────────────────

interface PlacementAdjustments {
  topOfSearch: number;
  restOfSearch: number;
  productPages: number;
}

export interface MacroSuggestionDTO {
  id: string;
  campaignId: string;
  title: string;
  why: string;
  bullets: string[];
  impactTag: 'stabiliser' | 'accélérer' | 'réduire dépenses' | 'protéger rentabilité';
  riskLevel: 'low' | 'medium' | 'high';
  actionType: string;
  executable: boolean;
  current: {
    biddingStrategy?: string;
    placements?: PlacementAdjustments;
    budget?: number;
  };
  recommended?: {
    biddingStrategy?: string;
    placements?: PlacementAdjustments;
    budget?: number;
  };
  guardrails?: {
    requiresConsent: boolean;
    consentLevel: string;
    cooldownDays?: number;
  };
  evidence: {
    strategicPeriodDays: number;
    trendPeriodDays?: number;
    acosStrategic?: number;
    acosTrend?: number;
    cvrStrategic?: number;
    cvrTrend?: number;
    spendShareImpacted?: number;
    budgetUtilization?: number;
    diagnosticsDistribution?: Record<string, number>;
  };
}

// ── Impact Tag Config ─────────────────────────────────

const IMPACT_CONFIG: Record<string, { bg: string; text: string; border: string; icon: string }> = {
  'stabiliser': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: '🛡️' },
  'accélérer': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: '🚀' },
  'réduire dépenses': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: '📉' },
  'protéger rentabilité': { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', icon: '🔒' },
};

const RISK_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  'low': { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Risque faible' },
  'medium': { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Risque modéré' },
  'high': { bg: 'bg-red-100', text: 'text-red-700', label: 'Risque élevé' },
};

// ── Component ─────────────────────────────────────────

interface MacroSuggestionsBlockProps {
  suggestions: MacroSuggestionDTO[];
  workspaceId?: string;
  onActionExecuted?: () => void;
}

export function MacroSuggestionsBlock({ suggestions, workspaceId, onActionExecuted }: MacroSuggestionsBlockProps) {
  const [selectedSuggestion, setSelectedSuggestion] = useState<MacroSuggestionDTO | null>(null);

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <>
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Ajustements structurels recommandés
          </span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700">
            Macro
          </span>
        </div>
        <div className="space-y-2">
          {suggestions.map((suggestion) => {
            const impact = IMPACT_CONFIG[suggestion.impactTag] || IMPACT_CONFIG['stabiliser'];
            const risk = RISK_CONFIG[suggestion.riskLevel] || RISK_CONFIG['medium'];

            return (
              <div
                key={suggestion.id}
                className={`rounded-lg border ${impact.border} ${impact.bg} p-3`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Title + Impact Tag */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-slate-800">
                        {impact.icon} {suggestion.title}
                      </span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${impact.bg} ${impact.text} border ${impact.border}`}>
                        {suggestion.impactTag}
                      </span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${risk.bg} ${risk.text}`}>
                        {risk.label}
                      </span>
                    </div>

                    {/* Why */}
                    <p className="text-xs text-slate-600 mb-2">{suggestion.why}</p>

                    {/* Bullets */}
                    <ul className="space-y-0.5">
                      {suggestion.bullets.map((bullet, i) => (
                        <li key={i} className="text-xs text-slate-500 flex items-start gap-1.5">
                          <span className="text-slate-400 mt-0.5">•</span>
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* CTA Button */}
                  <button
                    onClick={() => setSelectedSuggestion(suggestion)}
                    className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      suggestion.executable
                        ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                        : 'bg-white/50 border border-slate-200/50 text-slate-500'
                    }`}
                  >
                    {suggestion.executable ? 'Voir / Ajuster' : 'Voir comment faire'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal */}
      {selectedSuggestion && (
        <MacroActionModal
          suggestion={selectedSuggestion}
          workspaceId={workspaceId}
          onClose={() => setSelectedSuggestion(null)}
          onActionExecuted={onActionExecuted}
        />
      )}
    </>
  );
}
