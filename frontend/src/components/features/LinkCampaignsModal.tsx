'use client';
import React, { useEffect, useState, useMemo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { fetchAvailableCampaigns, linkCampaignToBook } from '@/lib/api/client';
import { t } from '@/lib/i18n';

interface LinkCampaignsModalProps {
  open: boolean;
  onClose: () => void;
  bookId: string;
  bookTitle: string;
  onLinked?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  sponsoredProducts: 'SP',
  sponsoredBrands: 'SB',
  sponsoredDisplay: 'SD',
};

const STATE_LABELS: Record<string, string> = {
  enabled: 'Active',
  paused: 'En pause',
  archived: 'Archivée',
};

const STATE_COLORS: Record<string, string> = {
  enabled: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  archived: 'bg-slate-100 text-slate-500',
};

export function LinkCampaignsModal({ open, onClose, bookId, bookTitle, onLinked }: LinkCampaignsModalProps) {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState(0);

  // ── Filtres ──
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterState, setFilterState] = useState<string>('all');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setPrimaryId(null);
    setSuccessCount(0);
    setSearchQuery('');
    setFilterType('all');
    setFilterState('all');
    fetchAvailableCampaigns(bookId)
      .then((data) => setCampaigns(Array.isArray(data) ? data : data?.campaigns || []))
      .catch((e) => setError(e.response?.data?.message || e.message))
      .finally(() => setLoading(false));
  }, [open, bookId]);

  // ── Campagnes filtrées ──
  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        if (!c.name?.toLowerCase().includes(q)) return false;
      }
      if (filterType !== 'all' && c.campaignType !== filterType) return false;
      if (filterState !== 'all' && c.state !== filterState) return false;
      return true;
    });
  }, [campaigns, searchQuery, filterType, filterState]);

  // ── Compteurs pour les badges de filtre ──
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    campaigns.forEach((c) => {
      const key = c.campaignType || 'other';
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [campaigns]);

  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    campaigns.forEach((c) => {
      const key = c.state || 'other';
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [campaigns]);

  const availableTypes = Object.keys(typeCounts);
  const availableStates = Object.keys(stateCounts);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (primaryId === id) setPrimaryId(null);
      } else {
        next.add(id);
        if (!primaryId) setPrimaryId(id);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    const filteredIds = new Set(filteredCampaigns.map((c) => c.id));
    const allFilteredSelected = filteredCampaigns.every((c) => selected.has(c.id));

    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        if (primaryId && filteredIds.has(primaryId)) setPrimaryId(null);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        if (!primaryId && filteredCampaigns.length > 0) setPrimaryId(filteredCampaigns[0].id);
        return next;
      });
    }
  };

  const handleLink = async () => {
    if (selected.size === 0) return;
    setLinking(true);
    setError(null);
    let count = 0;
    const errors: string[] = [];

    for (const campaignId of Array.from(selected)) {
      try {
        await linkCampaignToBook(bookId, campaignId, campaignId === primaryId);
        count++;
      } catch (err: any) {
        const name = campaigns.find((c) => c.id === campaignId)?.name || campaignId;
        errors.push(`${name}: ${err.response?.data?.message || err.message}`);
      }
    }

    setLinking(false);
    setSuccessCount(count);

    if (errors.length > 0) {
      setError(`${count} associée(s) avec succès. Erreurs: ${errors.join('; ')}`);
    }

    if (count > 0 && onLinked) {
      onLinked();
    }
  };

  const allFilteredSelected = filteredCampaigns.length > 0 && filteredCampaigns.every((c) => selected.has(c.id));
  const hasActiveFilters = searchQuery.trim() !== '' || filterType !== 'all' || filterState !== 'all';

  return (
    <Modal open={open} onClose={onClose} title={t('link_campaigns.title')} wide>
      {successCount > 0 && !error ? (
        <div className="py-8 text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-slate-900">
            {successCount} campagne(s) associée(s) à « {bookTitle} »
          </p>
          <p className="text-sm text-slate-500">
            {t('link_campaigns.success_hint')}
          </p>
          <Button variant="primary" onClick={onClose}>
            {t('common.back')}
          </Button>
        </div>
      ) : loading ? (
        <div className="py-8 text-center text-sm text-slate-500">{t('common.loading')}</div>
      ) : campaigns.length === 0 ? (
        <div className="py-8 text-center space-y-2">
          <p className="text-slate-500 text-sm">{t('link_campaigns.no_available')}</p>
          <p className="text-xs text-slate-400">{t('link_campaigns.no_available_hint')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {t('link_campaigns.description').replace('{book}', bookTitle)}
          </p>

          {/* ═══ Barre de recherche ═══ */}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Rechercher une campagne..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-8 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            )}
          </div>

          {/* ═══ Filtres rapides ═══ */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Filtre par type */}
            {availableTypes.length > 1 && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400 mr-1">Type :</span>
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                    filterType === 'all'
                      ? 'bg-brand-100 text-brand-700'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  Tous ({campaigns.length})
                </button>
                {availableTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilterType(filterType === type ? 'all' : type)}
                    className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                      filterType === type
                        ? 'bg-brand-100 text-brand-700'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {TYPE_LABELS[type] || type} ({typeCounts[type]})
                  </button>
                ))}
              </div>
            )}

            {/* Filtre par état */}
            {availableStates.length > 1 && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400 mr-1">État :</span>
                {availableStates.map((state) => (
                  <button
                    key={state}
                    onClick={() => setFilterState(filterState === state ? 'all' : state)}
                    className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                      filterState === state
                        ? 'bg-brand-100 text-brand-700'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {STATE_LABELS[state] || state} ({stateCounts[state]})
                  </button>
                ))}
              </div>
            )}

            {/* Bouton reset filtres */}
            {hasActiveFilters && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilterType('all');
                  setFilterState('all');
                }}
                className="px-2 py-1 rounded-full text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
              >
                Effacer les filtres
              </button>
            )}
          </div>

          {/* ═══ Compteur + sélection groupée ═══ */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {filteredCampaigns.length} campagne{filteredCampaigns.length > 1 ? 's' : ''} affichée{filteredCampaigns.length > 1 ? 's' : ''}
              {hasActiveFilters && ` sur ${campaigns.length}`}
            </p>
            <button
              onClick={selectAllFiltered}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
            >
              {allFilteredSelected ? t('link_campaigns.deselect_all') : t('link_campaigns.select_all')}
            </button>
          </div>

          {/* ═══ Liste des campagnes ═══ */}
          <div className="overflow-x-auto max-h-[40vh] overflow-y-auto border border-slate-200 rounded-lg">
            {filteredCampaigns.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">
                Aucune campagne ne correspond à ta recherche.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-3 w-8"></th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase">{t('campaigns.name')}</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-slate-500 uppercase">{t('campaigns.type')}</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-slate-500 uppercase">{t('campaigns.state')}</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 uppercase">{t('campaigns.daily_budget')}</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-slate-500 uppercase w-20">{t('link_campaigns.primary')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map((c: any) => {
                    const isSelected = selected.has(c.id);
                    return (
                      <tr
                        key={c.id}
                        className={`border-b border-slate-100 cursor-pointer transition-colors ${
                          isSelected ? 'bg-brand-50' : 'hover:bg-slate-50'
                        }`}
                        onClick={() => toggleSelect(c.id)}
                      >
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(c.id)}
                            className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-900 max-w-[220px]">
                          <HighlightedName name={c.name} query={searchQuery} />
                        </td>
                        <td className="py-2 px-3 text-center text-slate-600 text-xs">
                          {TYPE_LABELS[c.campaignType] || c.campaignType}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATE_COLORS[c.state] || 'bg-slate-100 text-slate-600'}`}>
                            {STATE_LABELS[c.state] || c.state}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-slate-700">
                          {c.dailyBudget ? `${Number(c.dailyBudget).toFixed(2)} €` : '—'}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {isSelected && (
                            <input
                              type="radio"
                              name="primary-campaign"
                              checked={primaryId === c.id}
                              onChange={() => setPrimaryId(c.id)}
                              className="text-accent-500 focus:ring-accent-500"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              {selected.size} campagne(s) sélectionnée(s)
              {primaryId && selected.has(primaryId) && ' · 1 principale'}
            </p>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
              <Button
                variant="accent"
                onClick={handleLink}
                loading={linking}
                disabled={selected.size === 0}
              >
                {t('link_campaigns.submit').replace('{count}', String(selected.size))}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Met en surbrillance le texte qui correspond à la recherche
 */
function HighlightedName({ name, query }: { name: string; query: string }) {
  if (!query.trim() || !name) return <span className="truncate block">{name}</span>;

  const idx = name.toLowerCase().indexOf(query.toLowerCase().trim());
  if (idx === -1) return <span className="truncate block">{name}</span>;

  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + query.trim().length);
  const after = name.slice(idx + query.trim().length);

  return (
    <span className="truncate block">
      {before}
      <mark className="bg-amber-200 text-slate-900 rounded px-0.5">{match}</mark>
      {after}
    </span>
  );
}
