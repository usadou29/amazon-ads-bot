/**
 * Adapter : mapCampaignEvolutionToViewModel + buildAuthorSummary
 * Transforme le JSON brut de l'API en ViewModel lisible pour l'UI auteur
 */

// ── Types bruts (API response) ──────────────────────────────────

export interface CampaignEvolutionResult {
  bookId: string;
  analyzedAt: string;
  maturityScore: number;
  maturityBreakdown: { structure: number; winnersExploited: number; diversification: number; stability: number };
  duplicationScore: number;
  chaosScore: number;
  scenario: string;
  campaignRoles: Array<{ campaignId: string; campaignName: string; roles: string[]; macroStrategy: string; confidence: number }>;
  structuralIssues: Array<{ type: string; severity: 'high' | 'medium' | 'low'; description: string; affectedEntities: string[] }>;
  suggestions: Array<{ priority: number; type: string; description: string; estimatedImpact: string; details: Record<string, any> }>;
  roadmap: Array<{ week: number; actions: Array<{ type: string; details: Record<string, any>; priority: 'high' | 'medium' | 'low'; estimatedDurationHours?: number }> }>;
  nextCampaignRecommendations: Array<{ campaignType: string; targetingType: string; matchTypes?: string[]; keywords?: string[]; estimatedDailyBudget: number; rationale: string; priority: string }>;
  diversificationOpportunities: Array<{ type: string; description: string; prerequisites: string[]; met: boolean; estimatedBudget?: number; priority: string }>;
  context: { lifecyclePhase: string; totalCampaigns: number; totalAdGroups: number; totalKeywords: number; totalProductTargets: number; totalWinnerKeywords: number; totalBoostCandidateKeywords: number };
}

// ── ViewModel (UI) ──────────────────────────────────────────────

export type StateTag = 'AUCUNE_CAMPAGNE' | 'CHAOS' | 'WINNERS' | 'STABLE';

export interface TopAction {
  title: string;
  description: string;
  why: string;
  ctaLabel: string;
  actionType: string;
  payload?: any;
  isExecutable: boolean;
}

export interface RoadmapItem {
  title: string;
  desc: string;
  priority: 'high' | 'medium' | 'low';
}

export interface RoadmapWeekVM {
  weekLabel: string;
  items: RoadmapItem[];
}

export interface EvolutionViewModel {
  summarySentence: string;
  scenarioLabel: string;
  stateTag: StateTag;
  topActions: TopAction[];
  roadmap: RoadmapWeekVM[];
  details: {
    duplicationScore: number;
    chaosScore: number;
    maturityScore: number;
    maturityBreakdown: { structure: number; winnersExploited: number; diversification: number; stability: number };
  };
  context: CampaignEvolutionResult['context'];
  raw: CampaignEvolutionResult;
}

// ── Scenario → StateTag ─────────────────────────────────────────

function scenarioToStateTag(scenario: string): StateTag {
  switch (scenario) {
    case 'scenario_a_no_campaigns': return 'AUCUNE_CAMPAGNE';
    case 'scenario_b_chaos_detected': return 'CHAOS';
    case 'scenario_c_winners_exist': return 'WINNERS';
    case 'scenario_stable': return 'STABLE';
    default: return 'STABLE';
  }
}

function scenarioToLabel(scenario: string): string {
  switch (scenario) {
    case 'scenario_a_no_campaigns': return 'Démarrage';
    case 'scenario_b_chaos_detected': return 'Restructuration';
    case 'scenario_c_winners_exist': return 'Croissance';
    case 'scenario_stable': return 'Optimisation';
    default: return 'Analyse';
  }
}

// ── Author-friendly wording ─────────────────────────────────────

export function buildAuthorSummary(result: CampaignEvolutionResult): string {
  const { scenario, context } = result;
  const { totalCampaigns, totalWinnerKeywords, totalKeywords } = context;

  switch (scenario) {
    case 'scenario_a_no_campaigns':
      return 'Tu n\'as pas encore de campagnes publicitaires pour ce livre. On va t\'aider à lancer tes premières pubs étape par étape.';

    case 'scenario_b_chaos_detected': {
      const parts: string[] = [];
      if (result.duplicationScore > 0.4) {
        parts.push('tes campagnes se cannibalisent (mêmes mots-clés partout)');
      }
      if (result.chaosScore > 0.6) {
        parts.push('la structure de tes campagnes est désorganisée');
      }
      const issue = parts.length > 0 ? parts.join(' et ') : 'ta structure publicitaire nécessite un nettoyage';
      return `${capitalize(issue)}. On va simplifier et réorganiser pour que chaque euro dépensé soit mieux ciblé.`;
    }

    case 'scenario_c_winners_exist': {
      const winnerWord = totalWinnerKeywords === 1 ? 'mot-clé gagnant' : 'mots-clés gagnants';
      return `Tu as ${totalWinnerKeywords} ${winnerWord} qui convertissent bien. On va les isoler et les pousser pour maximiser tes ventes.`;
    }

    case 'scenario_stable':
      return `Tes ${totalCampaigns} campagnes tournent de façon stable avec ${totalKeywords} mots-clés. On te suggère quelques optimisations pour continuer à progresser.`;

    default:
      return 'Analyse en cours de ton portefeuille publicitaire.';
  }
}

// ── Suggestion → TopAction ──────────────────────────────────────

function suggestionToAction(suggestion: CampaignEvolutionResult['suggestions'][0]): TopAction {
  const isCreateCampaign = suggestion.type === 'create_campaign';
  const isPause = suggestion.type === 'pause_campaign';
  const isBidIncrease = suggestion.type === 'bid_increase';

  let ctaLabel = 'Voir';
  let isExecutable = false;

  if (isCreateCampaign) {
    ctaLabel = 'Créer';
    isExecutable = true;
  } else if (isPause) {
    ctaLabel = 'Mettre en pause';
    isExecutable = false;
  } else if (isBidIncrease) {
    ctaLabel = 'Ajuster';
    isExecutable = false;
  } else if (suggestion.type === 'consolidate_adgroup' || suggestion.type === 'restructure') {
    ctaLabel = 'Voir le plan';
  } else if (suggestion.type === 'rename_campaign') {
    ctaLabel = 'Renommer';
  }

  return {
    title: suggestionTitle(suggestion),
    description: suggestion.description,
    why: generateWhyForSuggestion(suggestion),
    ctaLabel,
    actionType: suggestion.type,
    payload: suggestion.details,
    isExecutable,
  };
}

function generateWhyForSuggestion(s: CampaignEvolutionResult['suggestions'][0]): string {
  switch (s.type) {
    case 'create_campaign':
      return s.details?.targetingType === 'auto'
        ? 'Pour laisser Amazon découvrir les mots-clés qui convertissent.'
        : 'Pour cibler précisément les termes qui génèrent des ventes.';
    case 'pause_campaign':
      return 'Cette campagne dépense sans convertir — mieux vaut réallouer le budget.';
    case 'consolidate_adgroup':
      return 'Tes mots-clés sont dispersés — les regrouper améliore le Quality Score.';
    case 'bid_increase':
      return 'Ces mots-clés convertissent bien mais manquent de visibilité.';
    case 'rename_campaign':
      return 'Des noms clairs facilitent le suivi et évitent les erreurs.';
    case 'restructure':
      return 'Simplifier la structure réduit la cannibalisation et clarifie les résultats.';
    case 'negative_keyword':
      return 'Bloquer les termes non pertinents économise du budget.';
    default:
      return s.estimatedImpact || 'Optimisation recommandée par ton coach Amazon Ads.';
  }
}

function suggestionTitle(s: CampaignEvolutionResult['suggestions'][0]): string {
  switch (s.type) {
    case 'create_campaign': {
      const tt = s.details?.targetingType;
      const mt = s.details?.matchTypes;
      if (tt === 'auto') return 'Créer campagne Auto';
      if (mt?.includes('exact')) return 'Créer campagne Exact';
      if (mt?.includes('phrase')) return 'Créer campagne Phrase';
      return 'Créer une campagne';
    }
    case 'pause_campaign': return 'Mettre en pause une campagne';
    case 'consolidate_adgroup': return 'Consolider les mots-clés';
    case 'bid_increase': return 'Augmenter les enchères Winners';
    case 'rename_campaign': return 'Standardiser les noms';
    case 'restructure': return 'Restructurer les campagnes';
    case 'negative_keyword': return 'Ajouter des mots-clés négatifs';
    default: return s.description.slice(0, 50);
  }
}

// ── NextCampaignRecommendation → TopAction ──────────────────────

function recToAction(rec: CampaignEvolutionResult['nextCampaignRecommendations'][0]): TopAction {
  const matchLabel = rec.matchTypes?.join('/') || '';
  const typeLabel = rec.targetingType === 'auto' ? 'Auto' : matchLabel ? `${capitalize(matchLabel)}` : 'Manuelle';
  const campLabel = rec.campaignType === 'sponsoredBrands' ? 'SB' : rec.campaignType === 'sponsoredDisplay' ? 'SD' : 'SP';

  return {
    title: `Créer campagne ${campLabel} ${typeLabel}`,
    description: rec.rationale,
    why: generateWhyForRec(rec),
    ctaLabel: 'Créer',
    actionType: 'create_campaign',
    payload: {
      campaignType: rec.campaignType,
      targetingType: rec.targetingType,
      matchTypes: rec.matchTypes,
      keywords: rec.keywords,
      suggestedDailyBudget: rec.estimatedDailyBudget,
    },
    isExecutable: true,
  };
}

function generateWhyForRec(rec: CampaignEvolutionResult['nextCampaignRecommendations'][0]): string {
  if (rec.targetingType === 'auto') {
    return 'Laisse Amazon trouver les mots-clés qui marchent pour ton livre.';
  }
  if (rec.matchTypes?.includes('exact')) {
    return 'Isole tes gagnants en Exact pour maximiser le retour sur investissement.';
  }
  if (rec.matchTypes?.includes('phrase')) {
    return 'Capture les variantes de tes meilleurs mots-clés avec le ciblage Phrase.';
  }
  if (rec.campaignType === 'sponsoredBrands') {
    return 'Renforce ta visibilité de marque avec une campagne Sponsored Brands.';
  }
  return 'Diversifie ta stratégie pour toucher de nouveaux lecteurs.';
}

// ── Roadmap → RoadmapWeekVM ─────────────────────────────────────

function roadmapToVM(roadmap: CampaignEvolutionResult['roadmap']): RoadmapWeekVM[] {
  return roadmap.map((week) => ({
    weekLabel: `Semaine ${week.week}`,
    items: week.actions.map((action) => ({
      title: actionTypeToTitle(action.type),
      desc: action.details?.action || action.details?.rationale || '',
      priority: action.priority,
    })),
  }));
}

function actionTypeToTitle(type: string): string {
  switch (type) {
    case 'create_campaign': return 'Créer une campagne';
    case 'pause_campaign': return 'Mettre en pause';
    case 'consolidate_adgroup': return 'Consolider';
    case 'bid_adjustment': return 'Ajuster les enchères';
    case 'rename_campaign': return 'Renommer';
    case 'restructure': return 'Restructurer';
    case 'negative_keyword': return 'Négatifs';
    default: return type;
  }
}

// ── Main Adapter ────────────────────────────────────────────────

export function mapCampaignEvolutionToViewModel(result: CampaignEvolutionResult): EvolutionViewModel {
  const stateTag = scenarioToStateTag(result.scenario);
  const summarySentence = buildAuthorSummary(result);

  // Build top actions: merge suggestions + nextCampaignRecommendations, take top 3
  const fromSuggestions = result.suggestions.map(suggestionToAction);
  const fromRecs = result.nextCampaignRecommendations.map(recToAction);

  // Deduplicate: if a suggestion is already "create_campaign" and a rec also is, prefer the rec (more detailed)
  const allActions = [...fromSuggestions];
  for (const rec of fromRecs) {
    const exists = allActions.some(
      (a) => a.actionType === rec.actionType && a.payload?.targetingType === rec.payload?.targetingType && a.payload?.matchTypes?.[0] === rec.payload?.matchTypes?.[0],
    );
    if (!exists) allActions.push(rec);
  }

  // Sort by priority (suggestions have numeric priority, recs don't — put recs after)
  const topActions = allActions.slice(0, 3);

  return {
    summarySentence,
    scenarioLabel: scenarioToLabel(result.scenario),
    stateTag,
    topActions,
    roadmap: roadmapToVM(result.roadmap),
    details: {
      duplicationScore: result.duplicationScore,
      chaosScore: result.chaosScore,
      maturityScore: result.maturityScore,
      maturityBreakdown: result.maturityBreakdown,
    },
    context: result.context,
    raw: result,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
