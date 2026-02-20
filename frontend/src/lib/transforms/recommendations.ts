import { formatCurrency } from './metrics';

/**
 * Recommandation transformée pour l'affichage auteur-friendly.
 * On utilise les données réelles (contextData, suggestedAction, entityName)
 * pour générer des descriptions personnalisées et concrètes.
 */
export interface HumanRecommendation {
  id: string;
  title: string;
  /** Explication personnalisée du "pourquoi" avec les vrais chiffres */
  why: string;
  /** Impact attendu en langage concret */
  impact: string;
  /** Risque en langage clair */
  risk: string;
  riskLevel: 'low' | 'medium' | 'high';
  canSimulate: boolean;
  canApply: boolean;
  /** Nom de la campagne ou mot-clé concerné */
  entityName: string;
  /** Type d'entité (campaign, keyword, search_term) */
  entityType: string;
  /** Clé d'entité brute (pour regroupement) */
  entityKey: string;
  /** Score de confiance (0-100) */
  confidence: number | null;
  /** Métriques clés extraites de contextData */
  metrics: {
    spend?: number;
    sales?: number;
    acos?: number;
    clicks?: number;
    impressions?: number;
    orders?: number;
    ctr?: number;
    cvr?: number;
  };
  /** Date de création */
  createdAt: string | null;
  /** Action suggérée (pour l'affichage) */
  action: {
    type: string;
    description: string;
  };
  /** Conseil optionnel sur le livre (couverture, résumé, prix…) */
  bookAdvice?: string;
  // ── Strategy Engine fields ──
  /** Score stratégique (0-100) calculé par la matrice lifecycle */
  strategyScore: number | null;
  /** Label lisible : "Recommandé en Scaling", "Alternative prudente", etc. */
  strategyLabel: string | null;
  /** Cette reco est-elle la meilleure pour cette entité dans ce lifecycle ? */
  recommendedForLifecycle: boolean;
  /** Consentement requis avant application ? (surtout en Launch) */
  requiresConsent: boolean;
  /** Niveau de consentement : 'none' | 'basic' | 'reinforced' */
  consentLevel: 'none' | 'basic' | 'reinforced';
  /** Message pédagogique à afficher dans la modale de consentement */
  consentMessage?: string;
}

interface RuleTemplate {
  title: (ctx: TemplateContext) => string;
  why: (ctx: TemplateContext) => string;
  impact: (ctx: TemplateContext) => string;
  risk: string;
  riskLevel: 'low' | 'medium' | 'high';
  actionDesc: (ctx: TemplateContext) => string;
  /** Conseil optionnel sur le livre lui-même (couverture, résumé, prix…) */
  bookAdvice?: (ctx: TemplateContext) => string;
}

interface TemplateContext {
  entityName: string;
  /** Label lisible du type d'entité ("Cette campagne", "Ce mot-clé", etc.) */
  entityLabel: string;
  metrics: HumanRecommendation['metrics'];
  suggestedAction: Record<string, any>;
  /** Phase de cycle de vie du livre (si disponible) */
  phase?: 'launch' | 'scale' | 'evergreen' | 'relaunch';
}

function getEntityLabel(entityType: string): string {
  switch (entityType) {
    case 'keyword': return 'Ce mot-clé';
    case 'search_term': return 'Ce terme de recherche';
    case 'ad_group': return 'Ce groupe d\'annonces';
    case 'target': return 'Ce ciblage';
    default: return 'Cette campagne';
  }
}

const RULE_TEMPLATES: Record<string, RuleTemplate> = {
  pause_high_acos: {
    title: (ctx) => `Mettre en pause « ${ctx.entityName} »`,
    why: (ctx) => {
      const spend = ctx.metrics.spend ?? 0;
      const sales = ctx.metrics.sales ?? 0;
      const acos = ctx.metrics.acos;
      const label = ctx.entityLabel;
      if (spend > 0 && sales === 0) {
        return `${label} a dépensé ${formatCurrency(spend)} sans générer aucune vente. L'argent investi n'a pas de retour.`;
      }
      if (acos && acos > 100) {
        return `Tu dépenses ${formatCurrency(spend)} en pub pour ${formatCurrency(sales)} de ventes (ACoS de ${acos.toFixed(0)}%). Tu perds de l'argent sur chaque vente via ${label.toLowerCase()}.`;
      }
      return `${label} dépense beaucoup (${formatCurrency(spend)}) pour peu de résultats (${formatCurrency(sales)} de ventes). Le ratio n'est pas bon.`;
    },
    impact: (ctx) => {
      const spend = ctx.metrics.spend ?? 0;
      return `Économie immédiate d'environ ${formatCurrency(spend / 2)}/mois. Tu pourras réactiver si besoin.`;
    },
    risk: 'Perte de visibilité sur ce ciblage.',
    riskLevel: 'low',
    actionDesc: (ctx) => `Mettre ${ctx.entityLabel.toLowerCase()} en pause`,
  },

  bid_down_no_sales: {
    title: (ctx) => `Baisser l'enchère sur « ${ctx.entityName} »`,
    why: (ctx) => {
      const spend = ctx.metrics.spend ?? 0;
      const clicks = ctx.metrics.clicks ?? 0;
      const orders = ctx.metrics.orders ?? 0;
      if (orders === 0 && clicks > 0) {
        return `${clicks} clics pour ${formatCurrency(spend)} dépensés, mais aucune commande. L'enchère actuelle est trop élevée par rapport aux résultats.`;
      }
      return `Les résultats ne justifient pas l'enchère actuelle. ${clicks} clics pour seulement ${orders} commande${orders > 1 ? 's' : ''}.`;
    },
    impact: (ctx) => {
      const adjustment = ctx.suggestedAction?.adjustment_value;
      if (adjustment) {
        return `Réduction de l'enchère de ${Math.abs(Number(adjustment))}%. Meilleur ratio dépense/résultat.`;
      }
      return 'Meilleur ratio entre ce que tu dépenses et ce que tu gagnes.';
    },
    risk: 'Position légèrement moins visible dans les résultats Amazon.',
    riskLevel: 'low',
    actionDesc: (ctx) => {
      const adj = ctx.suggestedAction?.adjustment_value;
      return adj ? `Baisser l'enchère de ${Math.abs(Number(adj))}%` : 'Baisser l\'enchère';
    },
  },

  bid_up_high_performer: {
    title: (ctx) => `Booster « ${ctx.entityName} »`,
    why: (ctx) => {
      const sales = ctx.metrics.sales ?? 0;
      const orders = ctx.metrics.orders ?? 0;
      const cvr = ctx.metrics.cvr;
      const label = ctx.entityLabel;
      if (cvr && cvr > 5) {
        return `${label} convertit très bien (${cvr.toFixed(1)}% de conversion). ${orders} commande${orders > 1 ? 's' : ''} pour ${formatCurrency(sales)} de ventes. Ça mérite plus de budget.`;
      }
      return `${label} génère de bons résultats : ${orders} commande${orders > 1 ? 's' : ''}, ${formatCurrency(sales)} de ventes. Plus de visibilité = plus de ventes.`;
    },
    impact: (ctx) => {
      const adjustment = ctx.suggestedAction?.adjustment_value;
      if (adjustment) {
        return `Augmentation de l'enchère de +${Number(adjustment)}%. Plus de visibilité pour ce qui marche.`;
      }
      return 'Plus de ventes potentielles grâce à une meilleure visibilité.';
    },
    risk: 'Augmentation modérée des dépenses pub.',
    riskLevel: 'medium',
    actionDesc: (ctx) => {
      const adj = ctx.suggestedAction?.adjustment_value;
      return adj ? `Augmenter l'enchère de +${Number(adj)}%` : 'Augmenter l\'enchère';
    },
  },

  negative_unprofitable_search_term: {
    title: (ctx) => `Bloquer « ${ctx.entityName} »`,
    why: (ctx) => {
      const spend = ctx.metrics.spend ?? 0;
      const clicks = ctx.metrics.clicks ?? 0;
      return `Ce terme de recherche génère ${clicks} clics (${formatCurrency(spend)} dépensés) mais aucune vente. Les gens qui cherchent ça ne sont pas intéressés par ton livre.`;
    },
    impact: (ctx) => {
      const spend = ctx.metrics.spend ?? 0;
      return `Arrêt immédiat des dépenses inutiles (environ ${formatCurrency(spend)} économisés).`;
    },
    risk: 'Aucun — ce terme ne génère pas de ventes.',
    riskLevel: 'low',
    actionDesc: () => 'Ajouter en mot-clé négatif',
  },

  harvest_profitable_search_term: {
    title: (ctx) => `Exploiter « ${ctx.entityName} »`,
    why: (ctx) => {
      const sales = ctx.metrics.sales ?? 0;
      const orders = ctx.metrics.orders ?? 0;
      return `Ce terme de recherche a généré ${orders} commande${orders > 1 ? 's' : ''} (${formatCurrency(sales)} de ventes). En créant un mot-clé dédié, tu pourras mieux contrôler l'enchère et maximiser ce qui marche.`;
    },
    impact: () => 'Meilleur contrôle des enchères sur un terme qui convertit. Plus de ventes potentielles.',
    risk: 'Possible doublon temporaire avant que l\'ancien terme soit exclu.',
    riskLevel: 'low',
    actionDesc: () => 'Créer un mot-clé exact dédié',
  },

  // ═══════════════════════════════════════════════════════════
  // Règles budget & visibilité
  // ═══════════════════════════════════════════════════════════

  budget_capped: {
    title: (ctx) => `Budget épuisé sur « ${ctx.entityName} »`,
    why: (ctx) => {
      const impressions = ctx.metrics.impressions ?? 0;
      return `Cette campagne atteint son budget quotidien et s'arrête en cours de journée. Tu rates des impressions et potentiellement des ventes. (${impressions} impressions sur la période)`;
    },
    impact: () => 'Augmenter le budget quotidien permet de capter les ventes manquées. Si le ROI est bon, c\'est du profit en plus.',
    risk: 'Augmentation des dépenses — à surveiller les premiers jours.',
    riskLevel: 'medium',
    actionDesc: () => 'Augmenter le budget quotidien',
  },

  low_impressions: {
    title: (ctx) => `Peu de visibilité sur « ${ctx.entityName} »`,
    why: (ctx) => {
      const impressions = ctx.metrics.impressions ?? 0;
      return `Seulement ${impressions} impressions sur la période. Ton livre est très peu affiché — l'enchère est probablement trop basse ou les mots-clés trop concurrentiels.`;
    },
    impact: () => 'Plus d\'impressions = plus de chances de ventes. Sans visibilité, pas de résultats possibles.',
    risk: 'Augmenter l\'enchère coûtera un peu plus cher par clic.',
    riskLevel: 'low',
    actionDesc: () => 'Augmenter l\'enchère pour gagner en visibilité',
  },

  // ═══════════════════════════════════════════════════════════
  // Règles tendances
  // ═══════════════════════════════════════════════════════════

  performance_declining: {
    title: (ctx) => `Performance en baisse sur « ${ctx.entityName} »`,
    why: (ctx) => {
      const acos = ctx.metrics.acos;
      return `Les performances se dégradent depuis plusieurs jours${acos ? ` (ACoS actuel : ${acos.toFixed(1)}%)` : ''}. Le ratio dépenses/ventes empire.`;
    },
    impact: () => 'Agir maintenant évite de creuser les pertes. Une pause ou baisse d\'enchère peut stopper l\'hémorragie.',
    risk: 'Perte de position si on réduit trop les enchères.',
    riskLevel: 'medium',
    actionDesc: () => 'Baisser les enchères ou mettre en pause les mots-clés en baisse',
  },

  acos_above_royalty: {
    title: (ctx) => `Pub non rentable sur « ${ctx.entityName} »`,
    why: (ctx) => {
      const acos = ctx.metrics.acos;
      return `Ton ACoS (${acos ? acos.toFixed(1) : '?'}%) dépasse ton taux de redevance. Concrètement, chaque vente pub te fait perdre de l'argent car la pub coûte plus que ce que tu touches par livre.`;
    },
    impact: () => 'Baisser l\'ACoS sous ton taux de redevance te rendra rentable sur chaque vente pub.',
    risk: 'Baisser les enchères peut réduire le volume de ventes.',
    riskLevel: 'medium',
    actionDesc: () => 'Optimiser les enchères pour passer sous le seuil de rentabilité',
  },

  // ═══════════════════════════════════════════════════════════
  // LAUNCH — Règles de lancement (0-30 jours)
  // Ton encourageant et pédagogique
  // ═══════════════════════════════════════════════════════════

  launch_low_impressions_bid_up: {
    title: (ctx) => `Ton livre n'est pas encore visible — « ${ctx.entityName} »`,
    why: (ctx) => {
      const impressions = ctx.metrics.impressions ?? 0;
      return `Seulement ${impressions} impressions en phase de lancement. C'est normal au début, mais il faut que ton livre soit vu pour collecter des données. Sans visibilité, impossible de savoir ce qui marche.`;
    },
    impact: () => 'Plus d\'impressions = plus de données pour optimiser. C\'est l\'investissement initial indispensable en lancement.',
    risk: 'Coût par clic un peu plus élevé, mais c\'est le prix de la visibilité initiale.',
    riskLevel: 'low',
    actionDesc: (ctx) => {
      const adj = ctx.suggestedAction?.adjustment_value;
      return adj ? `Augmenter l'enchère de +${Number(adj)}% pour gagner en visibilité` : 'Augmenter l\'enchère pour gagner en visibilité';
    },
  },

  launch_low_ctr_cover_issue: {
    title: (ctx) => `Faible taux de clic — ta couverture accroche-t-elle ? « ${ctx.entityName} »`,
    why: (ctx) => {
      const impressions = ctx.metrics.impressions ?? 0;
      const ctr = ctx.metrics.ctr;
      return `Ton livre est affiché (${impressions} impressions) mais le taux de clic est faible${ctr ? ` (${ctr.toFixed(2)}%)` : ''}. Quand les lecteurs voient ta couverture dans les résultats, ils ne cliquent pas assez. Le problème vient probablement de ta couverture ou de ton titre.`;
    },
    impact: () => 'Améliorer le taux de clic multiplie l\'efficacité de toutes tes pubs sans dépenser plus.',
    risk: 'Aucun risque pub — c\'est un conseil sur ton livre.',
    riskLevel: 'low',
    actionDesc: () => 'Analyser et optimiser la couverture / le titre',
    bookAdvice: () => 'Ta couverture est ton premier vendeur. Compare-la aux best-sellers de ta catégorie. Est-elle lisible en miniature ? Le genre est-il identifiable en un coup d\'œil ?',
  },

  launch_good_ctr_no_sales: {
    title: (ctx) => `Les lecteurs cliquent mais n'achètent pas — « ${ctx.entityName} »`,
    why: (ctx) => {
      const clicks = ctx.metrics.clicks ?? 0;
      const ctr = ctx.metrics.ctr;
      return `Bonne nouvelle : ton livre attire les clics${ctr ? ` (${ctr.toFixed(2)}% de CTR)` : ''} — ${clicks} personnes ont cliqué. Mais personne n'achète. Le problème est sur ta page produit : résumé, avis, prix ou extrait.`;
    },
    impact: () => 'Corriger ta page produit peut transformer ces clics en ventes sans augmenter ton budget pub.',
    risk: 'Aucun risque pub — c\'est un conseil sur ta fiche livre.',
    riskLevel: 'low',
    actionDesc: () => 'Optimiser la page produit (résumé, extrait, prix)',
    bookAdvice: () => 'Retravaille ton résumé pour mieux accrocher les lecteurs qui cliquent. Vérifie aussi que l\'extrait donne envie et que le prix correspond à ta catégorie.',
  },

  launch_high_acos_patience: {
    title: (ctx) => `ACoS élevé mais c'est normal en lancement — « ${ctx.entityName} »`,
    why: (ctx) => {
      const acos = ctx.metrics.acos;
      const orders = ctx.metrics.orders ?? 0;
      return `L'ACoS est élevé${acos ? ` (${acos.toFixed(1)}%)` : ''} avec seulement ${orders} commande${orders > 1 ? 's' : ''}. En phase de lancement, c'est attendu : Amazon découvre ton livre et les données sont encore trop peu nombreuses pour tirer des conclusions.`;
    },
    impact: () => 'Patience. Les premières commandes sont les plus chères. Le coût par commande baisse à mesure que l\'algorithme apprend.',
    risk: 'Aucun — on surveille sans agir pour l\'instant.',
    riskLevel: 'low',
    actionDesc: () => 'Continuer à collecter des données — pas d\'action immédiate',
  },

  // ═══════════════════════════════════════════════════════════
  // SCALE — Règles de croissance (30-180 jours)
  // Ton décisif et orienté résultats
  // ═══════════════════════════════════════════════════════════

  scale_shift_budget_to_winners: {
    title: (ctx) => `Investir plus sur ce qui marche — « ${ctx.entityName} »`,
    why: (ctx) => {
      const orders = ctx.metrics.orders ?? 0;
      const acos = ctx.metrics.acos;
      const sales = ctx.metrics.sales ?? 0;
      return `${ctx.entityLabel} a prouvé son efficacité : ${orders} commande${orders > 1 ? 's' : ''}, ${formatCurrency(sales)} de ventes${acos ? `, ACoS de ${acos.toFixed(1)}%` : ''}. En phase de croissance, il faut doubler la mise sur les gagnants.`;
    },
    impact: (ctx) => {
      const adj = ctx.suggestedAction?.adjustment_value;
      return adj
        ? `Augmenter l'enchère de +${Number(adj)}% pour capter plus de ventes sur ce ciblage rentable.`
        : 'Plus de visibilité sur un ciblage rentable = croissance directe des ventes.';
    },
    risk: 'Augmentation maîtrisée des dépenses sur un ciblage déjà rentable.',
    riskLevel: 'low',
    actionDesc: (ctx) => {
      const adj = ctx.suggestedAction?.adjustment_value;
      return adj ? `Augmenter l'enchère de +${Number(adj)}%` : 'Augmenter l\'enchère';
    },
  },

  scale_cut_unprofitable_terms: {
    title: (ctx) => `Couper un terme non rentable — « ${ctx.entityName} »`,
    why: (ctx) => {
      const clicks = ctx.metrics.clicks ?? 0;
      const spend = ctx.metrics.spend ?? 0;
      return `${clicks} clics, ${formatCurrency(spend)} dépensés, zéro commande. En phase de croissance, on a assez de données pour trancher : ce terme ne convertit pas. Chaque euro dépensé ici est un euro qui ne va pas vers ce qui marche.`;
    },
    impact: (ctx) => {
      const spend = ctx.metrics.spend ?? 0;
      return `${formatCurrency(spend)} réaffectés vers les termes rentables.`;
    },
    risk: 'Aucun — ce terme ne génère pas de ventes.',
    riskLevel: 'low',
    actionDesc: () => 'Ajouter en mot-clé négatif',
  },

  scale_harvest_profitable_terms: {
    title: (ctx) => `Exploiter un terme gagnant — « ${ctx.entityName} »`,
    why: (ctx) => {
      const orders = ctx.metrics.orders ?? 0;
      const acos = ctx.metrics.acos;
      const sales = ctx.metrics.sales ?? 0;
      return `Ce terme de recherche a généré ${orders} commande${orders > 1 ? 's' : ''} (${formatCurrency(sales)})${acos ? ` avec un ACoS de ${acos.toFixed(1)}%` : ''}. C'est le moment de le promouvoir en mot-clé exact pour mieux contrôler l'enchère et maximiser ce levier.`;
    },
    impact: () => 'Contrôle direct de l\'enchère sur un terme qui convertit. Optimisation du coût par vente.',
    risk: 'Doublon temporaire possible. On ajustera une fois le nouveau mot-clé actif.',
    riskLevel: 'low',
    actionDesc: () => 'Créer un mot-clé exact dédié',
  },

  scale_optimize_placements: {
    title: (ctx) => `Optimiser les placements — « ${ctx.entityName} »`,
    why: (ctx) => {
      const acos = ctx.metrics.acos;
      return `Les données de placement montrent des écarts de performance significatifs${acos ? ` (ACoS moyen : ${acos.toFixed(1)}%)` : ''}. Certains emplacements (haut de recherche, pages produit) convertissent mieux que d'autres. Il est temps d'ajuster les multiplicateurs.`;
    },
    impact: () => 'Répartition optimale du budget vers les placements les plus rentables.',
    risk: 'Changement progressif — les résultats se voient sous 3-5 jours.',
    riskLevel: 'medium',
    actionDesc: () => 'Ajuster les multiplicateurs de placement',
  },

  // ═══════════════════════════════════════════════════════════
  // EVERGREEN — Règles d'entretien (180+ jours)
  // Ton calme et d'entretien
  // ═══════════════════════════════════════════════════════════

  evergreen_gradual_acos_tightening: {
    title: (ctx) => `Affiner l'ACoS progressivement — « ${ctx.entityName} »`,
    why: (ctx) => {
      const acos = ctx.metrics.acos;
      return `L'ACoS est légèrement au-dessus de ta cible${acos ? ` (${acos.toFixed(1)}%)` : ''}. En phase de croisière, on peut resserrer les enchères progressivement pour améliorer la rentabilité sans brusquer l'algorithme.`;
    },
    impact: (ctx) => {
      const adj = ctx.suggestedAction?.adjustment_value;
      return adj
        ? `Baisse douce de ${Math.abs(Number(adj))}%. Rentabilité améliorée en douceur.`
        : 'Rentabilité améliorée progressivement.';
    },
    risk: 'Légère baisse de visibilité possible. On ajuste petit à petit.',
    riskLevel: 'low',
    actionDesc: (ctx) => {
      const adj = ctx.suggestedAction?.adjustment_value;
      return adj ? `Baisser l'enchère de ${Math.abs(Number(adj))}%` : 'Baisser l\'enchère légèrement';
    },
  },

  evergreen_periodic_cleanup: {
    title: (ctx) => `Nettoyage périodique — « ${ctx.entityName} »`,
    why: (ctx) => {
      const clicks = ctx.metrics.clicks ?? 0;
      const spend = ctx.metrics.spend ?? 0;
      return `${clicks} clics, ${formatCurrency(spend)} dépensés sur 14 jours, aucune commande. Même en croisière, il faut élaguer régulièrement les termes qui consomment du budget sans résultat.`;
    },
    impact: (ctx) => {
      const spend = ctx.metrics.spend ?? 0;
      return `Budget assaini : ${formatCurrency(spend)} récupérés sur la période.`;
    },
    risk: 'Aucun — on supprime uniquement ce qui ne produit rien depuis longtemps.',
    riskLevel: 'low',
    actionDesc: () => 'Ajouter en mot-clé négatif',
  },

  evergreen_concentration_risk: {
    title: (ctx) => `Risque de concentration — « ${ctx.entityName} »`,
    why: () => 'La majorité de tes ventes viennent d\'un très petit nombre de mots-clés. Si l\'un d\'eux perd en performance (concurrence, saisonnalité), tes ventes chuteront brutalement. En croisière, il faut diversifier.',
    impact: () => 'Réduire la dépendance aux top keywords protège tes revenus à long terme.',
    risk: 'Les nouveaux mots-clés auront un ACoS temporairement plus élevé.',
    riskLevel: 'medium',
    actionDesc: () => 'Diversifier les mots-clés pour réduire la concentration',
    bookAdvice: () => 'Profite de cette phase stable pour tester de nouvelles catégories ou de nouveaux mots-clés liés à des thèmes connexes de ton livre.',
  },

  // ═══════════════════════════════════════════════════════════
  // RELAUNCH — Règle de relance (manuelle)
  // Ton de renouveau
  // ═══════════════════════════════════════════════════════════

  relaunch_cover_refresh: {
    title: (ctx) => `Aligner ta page produit avec ta nouvelle couverture — « ${ctx.entityName} »`,
    why: (ctx) => {
      const ctr = ctx.metrics.ctr;
      const cvr = ctx.metrics.cvr;
      return `Bonne nouvelle : ta nouvelle couverture attire${ctr ? ` (CTR de ${ctr.toFixed(2)}%)` : ''}. Mais le taux de conversion reste faible${cvr ? ` (${cvr.toFixed(1)}%)` : ''}. Les lecteurs cliquent grâce à la couverture, mais la page produit ne suit pas encore.`;
    },
    impact: () => 'Aligner résumé et extrait avec la nouvelle couverture peut booster les conversions significativement.',
    risk: 'Aucun risque pub — c\'est un conseil sur ta fiche livre.',
    riskLevel: 'low',
    actionDesc: () => 'Mettre à jour résumé et extrait pour correspondre à la nouvelle couverture',
    bookAdvice: () => 'Ta nouvelle couverture promet quelque chose aux lecteurs. Assure-toi que ton résumé tient cette promesse. Mets aussi à jour ton extrait si nécessaire.',
  },
};

const DEFAULT_TEMPLATE: RuleTemplate = {
  title: (ctx) => `Optimisation pour « ${ctx.entityName} »`,
  why: () => 'Notre analyse a détecté une opportunité d\'amélioration.',
  impact: () => 'Amélioration potentielle des performances de ta pub.',
  risk: 'Risque modéré — surveille les résultats après application.',
  riskLevel: 'medium',
  actionDesc: () => 'Appliquer l\'optimisation suggérée',
};

/**
 * Transforme une recommandation brute du backend en version auteur-friendly.
 * Utilise les données réelles (contextData, entityName, suggestedAction)
 * pour générer des descriptions personnalisées.
 */
export function transformRecommendation(raw: any, safetyMode: boolean): HumanRecommendation {
  // Identifier le template à utiliser
  const ruleId = raw.ruleSnapshot?.ruleName || raw.ruleSnapshot?.name || raw.actionType || '';
  const template = Object.entries(RULE_TEMPLATES)
    .find(([k]) => ruleId.toLowerCase().includes(k))?.[1] || DEFAULT_TEMPLATE;

  // Extraire les métriques du contextData
  const rawMetrics = raw.contextData?.metrics || {};
  const metrics: HumanRecommendation['metrics'] = {
    spend: rawMetrics.spend != null ? Number(rawMetrics.spend) : undefined,
    sales: rawMetrics.sales != null ? Number(rawMetrics.sales) : undefined,
    acos: rawMetrics.acos != null ? Number(rawMetrics.acos) : undefined,
    clicks: rawMetrics.clicks != null ? Number(rawMetrics.clicks) : undefined,
    impressions: rawMetrics.impressions != null ? Number(rawMetrics.impressions) : undefined,
    orders: rawMetrics.orders != null ? Number(rawMetrics.orders) : undefined,
    ctr: rawMetrics.ctr != null ? Number(rawMetrics.ctr) : undefined,
    cvr: rawMetrics.cvr != null ? Number(rawMetrics.cvr) : undefined,
  };

  // Nom de l'entité (résolu côté backend)
  const entityName = raw.entityName || raw.entityKey || 'Élément inconnu';
  const entityType = raw.entityType || 'campaign';

  // Phase du livre (si disponible dans contextData)
  const phase = raw.contextData?.lifecyclePhase || undefined;

  // Context pour les templates
  const ctx: TemplateContext = {
    entityName,
    entityLabel: getEntityLabel(entityType),
    metrics,
    suggestedAction: raw.suggestedAction || {},
    phase,
  };

  return {
    id: raw.id,
    title: template.title(ctx),
    why: template.why(ctx),
    impact: template.impact(ctx),
    risk: template.risk,
    riskLevel: raw.riskLevel || template.riskLevel,
    canSimulate: true,
    canApply: !safetyMode,
    entityName,
    entityType,
    entityKey: raw.entityKey || '',
    confidence: raw.confidenceScore ?? null,
    metrics,
    createdAt: raw.createdAt || null,
    action: {
      type: raw.actionType || 'unknown',
      description: template.actionDesc(ctx),
    },
    bookAdvice: template.bookAdvice ? template.bookAdvice(ctx) : undefined,
    // Strategy Engine fields (enrichis par le backend)
    strategyScore: raw.strategyScore ?? null,
    strategyLabel: raw.strategyLabel ?? null,
    recommendedForLifecycle: raw.recommendedForLifecycle ?? false,
    requiresConsent: raw.requiresConsent ?? false,
    consentLevel: raw.consentLevel ?? 'none',
    consentMessage: raw.consentMessage ?? undefined,
  };
}

/**
 * Regroupe les recommandations par entityKey.
 * Pour chaque groupe, la reco avec recommendedForLifecycle=true est mise en premier.
 * Les autres sont triées par strategyScore décroissant.
 */
export interface RecommendationGroup {
  entityKey: string;
  entityName: string;
  entityType: string;
  recommended: HumanRecommendation | null;
  alternatives: HumanRecommendation[];
}

export function groupRecommendationsByEntity(recos: HumanRecommendation[]): RecommendationGroup[] {
  const groups: Record<string, HumanRecommendation[]> = {};

  for (const reco of recos) {
    const key = reco.entityKey || reco.id;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(reco);
  }

  const result: RecommendationGroup[] = [];

  const keys = Object.keys(groups);
  for (const entityKey of keys) {
    const groupRecos = groups[entityKey];
    // Trier par strategyScore décroissant
    groupRecos.sort((a: HumanRecommendation, b: HumanRecommendation) =>
      (b.strategyScore ?? 0) - (a.strategyScore ?? 0),
    );

    const recommended = groupRecos.find((r: HumanRecommendation) => r.recommendedForLifecycle) || null;
    const alternatives = groupRecos.filter((r: HumanRecommendation) => r !== recommended);

    // Si pas de recommended, prendre la première (meilleur score)
    const primary = recommended || groupRecos[0];
    const alts = recommended ? alternatives : groupRecos.slice(1);

    result.push({
      entityKey,
      entityName: primary?.entityName || entityKey,
      entityType: primary?.entityType || 'keyword',
      recommended: primary,
      alternatives: alts,
    });
  }

  // Trier les groupes : ceux avec une reco recommandée en premier, puis par score
  result.sort((a: RecommendationGroup, b: RecommendationGroup) => {
    const aScore = a.recommended?.strategyScore ?? 0;
    const bScore = b.recommended?.strategyScore ?? 0;
    const aRec = a.recommended?.recommendedForLifecycle ? 1 : 0;
    const bRec = b.recommended?.recommendedForLifecycle ? 1 : 0;
    if (aRec !== bRec) return bRec - aRec;
    return bScore - aScore;
  });

  return result;
}
