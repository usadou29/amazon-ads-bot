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
}

interface RuleTemplate {
  title: (ctx: TemplateContext) => string;
  why: (ctx: TemplateContext) => string;
  impact: (ctx: TemplateContext) => string;
  risk: string;
  riskLevel: 'low' | 'medium' | 'high';
  actionDesc: (ctx: TemplateContext) => string;
}

interface TemplateContext {
  entityName: string;
  /** Label lisible du type d'entité ("Cette campagne", "Ce mot-clé", etc.) */
  entityLabel: string;
  metrics: HumanRecommendation['metrics'];
  suggestedAction: Record<string, any>;
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

  // Context pour les templates
  const ctx: TemplateContext = {
    entityName,
    entityLabel: getEntityLabel(entityType),
    metrics,
    suggestedAction: raw.suggestedAction || {},
  };

  return {
    id: raw.id,
    title: template.title(ctx),
    why: template.why(ctx),
    impact: template.impact(ctx),
    risk: template.risk,
    riskLevel: template.riskLevel,
    canSimulate: true,
    canApply: !safetyMode,
    entityName,
    entityType,
    confidence: raw.confidenceScore ?? null,
    metrics,
    createdAt: raw.createdAt || null,
    action: {
      type: raw.actionType || 'unknown',
      description: template.actionDesc(ctx),
    },
  };
}
