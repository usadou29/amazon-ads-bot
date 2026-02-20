'use client';
import React, { useState, useEffect, useCallback } from 'react';

/**
 * Deux modes de saisie de la redevance :
 * 1. "percentage" → choix rapide (35%, 70%, custom %, ou inconnu → estimation 25%)
 * 2. "unit" → prix de vente + redevance en € par livre (plus précis)
 *
 * Dans les deux cas, on calcule un royaltyRate (%) pour le backend.
 */

export interface RoyaltyValues {
  royaltyRate: number | null;     // % final (null = estimation 25%)
  salePrice: number | null;       // prix de vente en €
  royaltyPerUnit: number | null;  // redevance en € par livre
}

interface RoyaltyEditorProps {
  /** Valeurs initiales venant du backend */
  initialRate?: number | null;
  initialSalePrice?: number | null;
  initialRoyaltyPerUnit?: number | null;
  /** Appelé quand les valeurs changent (pour formulaire parent) */
  onChange: (values: RoyaltyValues) => void;
  /** Mode compact (pour le modal de création) vs étendu (page détail) */
  compact?: boolean;
}

const PERCENTAGE_PRESETS = [
  { value: 'unknown', label: 'Je ne sais pas (estimation 25%)' },
  { value: '35', label: '35% — Taux standard KDP' },
  { value: '70', label: '70% — Taux premium KDP' },
  { value: 'custom', label: 'Autre pourcentage...' },
];

type Mode = 'percentage' | 'unit';

export function RoyaltyEditor({
  initialRate,
  initialSalePrice,
  initialRoyaltyPerUnit,
  onChange,
  compact = false,
}: RoyaltyEditorProps) {
  // Mode par défaut : "Prix & redevance par livre" (plus intuitif pour les auteurs)
  // On bascule en mode pourcentage seulement si l'auteur a déjà un taux défini sans données prix/unité
  const hasUnitData = initialSalePrice && initialSalePrice > 0 && initialRoyaltyPerUnit && initialRoyaltyPerUnit > 0;
  const hasPercentOnly = !hasUnitData && initialRate && initialRate > 0;

  const [mode, setMode] = useState<Mode>(hasPercentOnly ? 'percentage' : 'unit');

  // Mode pourcentage
  const [percentOption, setPercentOption] = useState(() => {
    if (hasUnitData) return 'unknown'; // on est en mode unit
    if (!initialRate || initialRate <= 0) return 'unknown';
    if (initialRate === 35) return '35';
    if (initialRate === 70) return '70';
    return 'custom';
  });
  const [customPercent, setCustomPercent] = useState(() => {
    if (!initialRate || initialRate <= 0 || initialRate === 35 || initialRate === 70) return '';
    return String(initialRate);
  });

  // Mode prix + redevance par livre
  const [salePrice, setSalePrice] = useState(initialSalePrice ? String(initialSalePrice) : '');
  const [royaltyPerUnit, setRoyaltyPerUnit] = useState(initialRoyaltyPerUnit ? String(initialRoyaltyPerUnit) : '');

  // Calculer le taux à partir du mode actif
  const computeValues = useCallback((): RoyaltyValues => {
    if (mode === 'unit') {
      const price = parseFloat(salePrice);
      const perUnit = parseFloat(royaltyPerUnit);
      if (!isNaN(price) && price > 0 && !isNaN(perUnit) && perUnit > 0) {
        const rate = Math.round((perUnit / price) * 10000) / 100; // 2 décimales
        return {
          royaltyRate: rate,
          salePrice: price,
          royaltyPerUnit: perUnit,
        };
      }
      return { royaltyRate: null, salePrice: null, royaltyPerUnit: null };
    }

    // Mode pourcentage
    if (percentOption === 'unknown') {
      return { royaltyRate: null, salePrice: null, royaltyPerUnit: null };
    }
    if (percentOption === 'custom') {
      const val = parseFloat(customPercent);
      if (!isNaN(val) && val >= 1 && val <= 100) {
        return { royaltyRate: val, salePrice: null, royaltyPerUnit: null };
      }
      return { royaltyRate: null, salePrice: null, royaltyPerUnit: null };
    }
    return { royaltyRate: Number(percentOption), salePrice: null, royaltyPerUnit: null };
  }, [mode, percentOption, customPercent, salePrice, royaltyPerUnit]);

  // Émettre les changements
  useEffect(() => {
    onChange(computeValues());
  }, [mode, percentOption, customPercent, salePrice, royaltyPerUnit]);

  // Taux calculé en mode unit (pour l'affichage)
  const unitComputedRate = (() => {
    const price = parseFloat(salePrice);
    const perUnit = parseFloat(royaltyPerUnit);
    if (!isNaN(price) && price > 0 && !isNaN(perUnit) && perUnit > 0) {
      return Math.round((perUnit / price) * 10000) / 100;
    }
    return null;
  })();

  const inputClass = 'px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500';

  return (
    <div>
      {/* Label + explication */}
      <label className="block text-sm font-medium text-slate-700 mb-1">
        Ta redevance KDP
      </label>
      {!compact && (
        <p className="text-xs text-slate-500 mb-2">
          C'est ce que tu touches vraiment sur chaque vente Amazon. Ça nous permet de calculer tes gains réels.
        </p>
      )}

      {/* Sélection du mode */}
      <div className="flex gap-1 mb-3 bg-slate-100 rounded-lg p-0.5">
        <button
          type="button"
          onClick={() => setMode('percentage')}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            mode === 'percentage'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Pourcentage
        </button>
        <button
          type="button"
          onClick={() => setMode('unit')}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            mode === 'unit'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Prix & redevance par livre
        </button>
      </div>

      {/* ── MODE POURCENTAGE ── */}
      {mode === 'percentage' && (
        <div>
          <select
            value={percentOption}
            onChange={(e) => setPercentOption(e.target.value)}
            className={`w-full ${inputClass} bg-white`}
          >
            {PERCENTAGE_PRESETS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {percentOption === 'custom' && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                value={customPercent}
                onChange={(e) => setCustomPercent(e.target.value)}
                placeholder="ex: 45"
                min={1}
                max={100}
                step="0.1"
                className={`w-24 ${inputClass}`}
              />
              <span className="text-sm text-slate-500">%</span>
            </div>
          )}

          {percentOption === 'unknown' && (
            <p className="text-xs text-amber-600 mt-1.5">
              On estimera tes gains à 25% des ventes Amazon. Tu pourras ajuster plus tard.
            </p>
          )}
        </div>
      )}

      {/* ── MODE PRIX + REDEVANCE PAR LIVRE ── */}
      {mode === 'unit' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Entre le prix de vente de ton livre et ce que tu touches par exemplaire vendu. On calculera le pourcentage automatiquement.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-600 mb-1">Prix de vente</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  placeholder="12.99"
                  min={0.01}
                  step="0.01"
                  className={`w-full ${inputClass}`}
                />
                <span className="text-sm text-slate-500">€</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Tu touches par livre</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={royaltyPerUnit}
                  onChange={(e) => setRoyaltyPerUnit(e.target.value)}
                  placeholder="3.33"
                  min={0.01}
                  step="0.01"
                  className={`w-full ${inputClass}`}
                />
                <span className="text-sm text-slate-500">€</span>
              </div>
            </div>
          </div>

          {/* Affichage du taux calculé */}
          {unitComputedRate !== null && (
            <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg">
              <p className="text-xs text-emerald-700">
                Taux de redevance calculé : <span className="font-bold">{unitComputedRate.toFixed(1)}%</span>
                {' '}— Tu touches {royaltyPerUnit}€ sur {salePrice}€ de vente.
              </p>
            </div>
          )}

          {!unitComputedRate && salePrice && royaltyPerUnit && (
            <p className="text-xs text-red-500">
              Vérifie les montants : le prix de vente et la redevance doivent être supérieurs à 0.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
