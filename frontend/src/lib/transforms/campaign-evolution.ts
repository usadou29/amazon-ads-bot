/**
 * Adapter : mapCampaignEvolutionToViewModel
 * Transforme le JSON brut de l'API en ViewModel lisible pour l'UI auteur
 */

// ── Types bruts (API response) ──────────────────────────────────

export interface TopFocusEvidence {
  label: string;
  value: string;
}

export interface TopFocusCta {
  label: string;
  intent: 'CREATE' | 'CLEANUP' | 'AMPLIFY' | 'OBSERVE';
  planId?: string;
}

export interface TopFocus {
  theme: 'VISIBILITE' | 'CONVERSION' | 'RENTABILITE' | 'STRUCTURE';
  title: string;
  summary: string;
  evidence: TopFocusEvidence[];
  primaryCta: TopFocusCta;
}

export interface CampaignExplanation {
  parameter: string;
  value: string;
  reasoning: string;
  dataSource: string;
}

export interface CampaignToCreate {
  name: string;
  type: string;
  targetingMode: 'AUTO' | 'MANUAL';
  dailyBudget: number;
  defaultBid: number;
  biddingStrategy: string;
  placementAdjustments?: { topOfSearch: number; restOfSearch: number; productPages: number };
  seedKeywords?: string[];
  seedAsins?: string[];
  negativeKeywords?: string[];
  notesWhy: string;
  explanations: CampaignExplanation[];
}

export interface CampaignToPause {
  campaignId: string;
  name: string;
  reason: string;
  harvestedKeywords?: string[];
  harvestedAsins?: string[];
}

export interface PauseStrategy {
  campaignsToPause: CampaignToPause[];
  totalBudgetToSave: number;
}

export interface CreationPlan {
  planId: string;
  fingerprint: string;
  campaignsToCreate: CampaignToCreate[];
  gaps?: string[];
  pauseStrategy?: PauseStrategy;
}

export type GapSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface StructuralGap {
  type: string;
  severity: GapSeverity;
  label: string;
  explanation: string;
  campaignsToCreate: string[];
}

export interface LifecycleDetection {
  phase: string;
  confidence: number;
  reasonBullets: string[];
}

export interface WinnerKeywordAsset {
  text: string;
  matchType: string;
  acos?: number;
  orders?: number;
  campaignId: string;
}

export interface SearchTermAsset {
  query: string;
  count: number;
}

export interface HarvestedAssets {
  winnerKeywords: WinnerKeywordAsset[];
  winnerSearchTerms: SearchTermAsset[];
  winnerAsins: string[];
  suggestedNegatives: string[];
  windowDays: number;
  avgWinningBid: number | null;
  avgCpcObserved: number | null;
  topPlacementPerformance: number | null;
  userProvidedKeywords: string[];
}

export type CreationMode = 'HARVEST' | 'RESET';

export interface CreationPlanResponse {
  creationPlan: CreationPlan;
  roadmap: Array<{ week: number; title: string; actions: Array<{ type: string; details: Record<string, any>; priority: 'high' | 'medium' | 'low'; estimatedDurationHours?: number; why: string; impact: string }> }>;
  gaps: StructuralGap[];
  harvestedAssets: HarvestedAssets;
  lifecycleUsed: string;
  modeUsed: CreationMode;
}

export interface CampaignEvolutionResult {
  bookId: string;
  analyzedAt: string;
  maturityScore: number;
  maturityBreakdown: { structure: number; winnersExploited: number; diversification: number; stability: number };
  duplicationScore: number;
  chaosScore: number;
  scenario: string;
  topFocus: TopFocus;
  creationPlan?: CreationPlan;
  gaps?: StructuralGap[];
  lifecycleDetected?: LifecycleDetection;
  campaignRoles: Array<{ campaignId: string; campaignName: string; roles: string[]; macroStrategy: string; confidence: number }>;
  structuralIssues: Array<{ type: string; severity: 'high' | 'medium' | 'low'; description: string; affectedEntities: string[] }>;
  suggestions: Array<{ priority: number; type: string; description: string; estimatedImpact: string; details: Record<string, any> }>;
  roadmap: Array<{ week: number; title: string; actions: Array<{ type: string; details: Record<string, any>; priority: 'high' | 'medium' | 'low'; estimatedDurationHours?: number; why: string; impact: string }> }>;
  nextCampaignRecommendations: Array<{ campaignType: string; targetingType: string; matchTypes?: string[]; keywords?: string[]; estimatedDailyBudget: number; rationale: string; priority: string }>;
  diversificationOpportunities: Array<{ type: string; description: string; prerequisites: string[]; met: boolean; estimatedBudget?: number; priority: string }>;
  context: { lifecyclePhase: string; totalCampaigns: number; totalAdGroups: number; totalKeywords: number; totalProductTargets: number; totalWinnerKeywords: number; totalBoostCandidateKeywords: number; avgAcos?: number; totalSpend30d?: number; totalSales30d?: number };
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
  why: string;
  impact: string;
  priority: 'high' | 'medium' | 'low';
}

export interface RoadmapWeekVM {
  weekLabel: string;
  weekTitle: string;
  items: RoadmapItem[];
}

export interface EvolutionViewModel {
  // Top Focus (primary display)
  topFocus: TopFocus;
  creationPlan?: CreationPlan;
  gaps: StructuralGap[];
  lifecycleDetected?: LifecycleDetection;

  // Legacy fields
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

// ── Suggestion → TopAction ──────────────────────────────────────

function suggestionToAction(suggestion: CampaignEvolutionResult['suggestions'][0]): TopAction {
  const isCreateCampaign = suggestion.type === 'create_campaign';

  let ctaLabel = 'Voir';
  let isExecutable = false;

  if (isCreateCampaign) {
    ctaLabel = 'Créer';
    isExecutable = true;
  } else if (suggestion.type === 'pause_campaign') {
    ctaLabel = 'Mettre en pause';
  } else if (suggestion.type === 'bid_increase') {
    ctaLabel = 'Ajuster';
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

// ── Roadmap → RoadmapWeekVM (enriched) ──────────────────────────

function roadmapToVM(roadmap: CampaignEvolutionResult['roadmap']): RoadmapWeekVM[] {
  return roadmap.map((week) => ({
    weekLabel: `Semaine ${week.week}`,
    weekTitle: week.title || `Semaine ${week.week}`,
    items: week.actions.map((action) => ({
      title: actionTypeToTitle(action.type),
      desc: action.details?.action || action.details?.rationale || '',
      why: action.why || '',
      impact: action.impact || '',
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

  // Build top actions: merge suggestions + nextCampaignRecommendations, take top 3
  const fromSuggestions = result.suggestions.map(suggestionToAction);
  const fromRecs = result.nextCampaignRecommendations.map(recToAction);

  const allActions = [...fromSuggestions];
  for (const rec of fromRecs) {
    const exists = allActions.some(
      (a) => a.actionType === rec.actionType && a.payload?.targetingType === rec.payload?.targetingType && a.payload?.matchTypes?.[0] === rec.payload?.matchTypes?.[0],
    );
    if (!exists) allActions.push(rec);
  }

  const topActions = allActions.slice(0, 3);

  return {
    topFocus: result.topFocus,
    creationPlan: result.creationPlan,
    gaps: result.gaps || [],
    lifecycleDetected: result.lifecycleDetected,
    summarySentence: result.topFocus.summary,
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
