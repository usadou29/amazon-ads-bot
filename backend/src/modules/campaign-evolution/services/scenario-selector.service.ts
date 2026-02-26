import { Injectable, Logger } from '@nestjs/common';
import {
  Scenario,
  type CampaignWithEntities,
  type EntityInsight,
  type ScenarioContext,
  type StructuralSuggestion,
  type NextCampaignRecommendation,
  type DiversificationOpportunity,
  type BookContext,
} from '../campaign-evolution.types';
import {
  CHAOS_THRESHOLD,
  DUPLICATION_THRESHOLD,
  DEFAULT_AUTO_CAMPAIGN_BUDGET,
  DEFAULT_MANUAL_CAMPAIGN_BUDGET,
  DEFAULT_SB_CAMPAIGN_BUDGET,
  SB_MIN_WINNER_KEYWORDS,
  SB_ACOS_FACTOR,
  SB_MIN_MONTHLY_SALES,
  SB_MIN_PROFITABLE_DAYS,
  BID_INCREASE_PERCENT,
} from '../constants';

@Injectable()
export class ScenarioSelectorService {
  private readonly logger = new Logger(ScenarioSelectorService.name);

  // ── Scenario Selection ────────────────────────────────────────

  selectScenario(
    campaigns: CampaignWithEntities[],
    duplicationScore: number,
    chaosScore: number,
    entityInsightsMap: Map<string, EntityInsight[]>,
  ): Scenario {
    // A : pas de campagnes
    if (campaigns.filter((c) => c.state !== 'archived').length === 0) {
      return Scenario.A;
    }

    // B : chaos ou duplication élevée
    if (chaosScore > CHAOS_THRESHOLD || duplicationScore > DUPLICATION_THRESHOLD) {
      return Scenario.B;
    }

    // C : des WINNERs existent
    for (const [, insights] of entityInsightsMap) {
      for (const insight of insights) {
        if (insight.diagnosisCode === 'winner') {
          return Scenario.C;
        }
      }
    }

    return Scenario.STABLE;
  }

  // ── Suggestions Generation ────────────────────────────────────

  generateSuggestions(ctx: ScenarioContext): StructuralSuggestion[] {
    switch (ctx.duplicationScore > DUPLICATION_THRESHOLD || ctx.chaosScore > CHAOS_THRESHOLD
      ? Scenario.B
      : this.selectScenario(ctx.campaigns, ctx.duplicationScore, ctx.chaosScore, ctx.entityInsightsMap)) {
      case Scenario.A:
        return this.suggestionsForA(ctx);
      case Scenario.B:
        return this.suggestionsForB(ctx);
      case Scenario.C:
        return this.suggestionsForC(ctx);
      case Scenario.STABLE:
        return this.suggestionsForStable(ctx);
      default:
        return [];
    }
  }

  private suggestionsForA(ctx: ScenarioContext): StructuralSuggestion[] {
    return [
      {
        priority: 10,
        type: 'create_campaign',
        description: 'Créer une campagne SP Auto pour commencer la collecte de données',
        estimatedImpact: 'Essentiel pour obtenir les premiers signaux de recherche',
        details: {
          campaignType: 'sponsoredProducts',
          targetingType: 'auto',
          suggestedDailyBudget: DEFAULT_AUTO_CAMPAIGN_BUDGET,
        },
      },
      {
        priority: 9,
        type: 'create_campaign',
        description: 'Créer une campagne SP Exact pour les mots-clés à forte intention',
        estimatedImpact: 'Capture les recherches précises liées au livre',
        details: {
          campaignType: 'sponsoredProducts',
          targetingType: 'manual',
          matchTypes: ['exact'],
          suggestedDailyBudget: DEFAULT_MANUAL_CAMPAIGN_BUDGET,
        },
      },
      {
        priority: 8,
        type: 'create_campaign',
        description: 'Créer une campagne SP Phrase pour valider les termes de recherche',
        estimatedImpact: 'Élargit la couverture tout en maintenant la pertinence',
        details: {
          campaignType: 'sponsoredProducts',
          targetingType: 'manual',
          matchTypes: ['phrase'],
          suggestedDailyBudget: DEFAULT_MANUAL_CAMPAIGN_BUDGET,
        },
      },
    ];
  }

  private suggestionsForB(ctx: ScenarioContext): StructuralSuggestion[] {
    const suggestions: StructuralSuggestion[] = [];

    // Trouver les duplications à résoudre
    if (ctx.duplicationScore > DUPLICATION_THRESHOLD) {
      suggestions.push({
        priority: 10,
        type: 'consolidate_adgroup',
        description: 'Consolider les mots-clés dupliqués entre campagnes pour éliminer la compétition interne',
        estimatedImpact: `Peut réduire le gaspillage de 10-15% (score duplication: ${(ctx.duplicationScore * 100).toFixed(0)}%)`,
        details: { duplicationScore: ctx.duplicationScore },
      });
    }

    // Chaos structurel
    if (ctx.chaosScore > CHAOS_THRESHOLD) {
      // Identifier les campagnes "unknown" à restructurer
      const unknownCampaigns = ctx.campaignRoles.filter((r) =>
        r.roles.includes('unknown'),
      );
      if (unknownCampaigns.length > 0) {
        suggestions.push({
          priority: 9,
          type: 'restructure',
          description: `Restructurer ${unknownCampaigns.length} campagne(s) au rôle indéfini`,
          estimatedImpact: 'Clarifie la stratégie et simplifie le portefeuille',
          details: {
            campaignIds: unknownCampaigns.map((c) => c.campaignId),
            campaignNames: unknownCampaigns.map((c) => c.campaignName),
          },
        });
      }

      // Nommage incohérent
      suggestions.push({
        priority: 7,
        type: 'rename_campaign',
        description: 'Standardiser les noms de campagnes selon le format : {Livre}-{MatchType}-{Rôle}',
        estimatedImpact: 'Améliore la lisibilité et la gestion quotidienne',
        details: { chaosScore: ctx.chaosScore },
      });
    }

    return suggestions;
  }

  private suggestionsForC(ctx: ScenarioContext): StructuralSuggestion[] {
    const suggestions: StructuralSuggestion[] = [];

    // Identifier les WINNERs
    const winners: Array<{ entityKey: string; campaignId: string; campaignName: string }> = [];
    for (const [campaignId, insights] of ctx.entityInsightsMap) {
      const campaign = ctx.campaigns.find((c) => c.id === campaignId);
      for (const insight of insights) {
        if (insight.diagnosisCode === 'winner') {
          winners.push({
            entityKey: insight.entityKey,
            campaignId,
            campaignName: campaign?.name || 'unknown',
          });
        }
      }
    }

    // Isoler les winners qui ne sont pas encore en exact
    const winnersNotInExact = winners.filter((w) => {
      const campaign = ctx.campaigns.find((c) => c.id === w.campaignId);
      if (!campaign) return true;
      // Vérifier si ce winner est dans une campagne exact
      const isExact = campaign.adGroups.some((ag) =>
        ag.keywords.some(
          (k) =>
            k.matchType === 'exact' &&
            k.state !== 'archived' &&
            `keyword:${k.id}` === w.entityKey,
        ),
      );
      return !isExact;
    });

    if (winnersNotInExact.length > 0) {
      suggestions.push({
        priority: 10,
        type: 'create_campaign',
        description: `Isoler ${winnersNotInExact.length} WINNER(s) dans une campagne exact dédiée`,
        estimatedImpact: 'Maximise le contrôle des enchères sur les termes les plus rentables',
        details: {
          winners: winnersNotInExact.map((w) => w.entityKey),
        },
      });
    }

    // Augmenter les bids sur les winners existants
    if (winners.length > 0) {
      suggestions.push({
        priority: 8,
        type: 'bid_increase',
        description: `Augmenter les enchères de ${BID_INCREASE_PERCENT}% sur les ${winners.length} WINNER(s) pour maximiser la part de marché`,
        estimatedImpact: 'Peut augmenter les ventes de 5-10% avec un impact ACoS contrôlé',
        details: { bidIncreasePercent: BID_INCREASE_PERCENT, winnersCount: winners.length },
      });
    }

    return suggestions;
  }

  private suggestionsForStable(ctx: ScenarioContext): StructuralSuggestion[] {
    const suggestions: StructuralSuggestion[] = [];

    // Vérifier les rôles manquants
    const allRoles = new Set(ctx.campaignRoles.flatMap((cr) => cr.roles));
    if (!allRoles.has('diversification')) {
      suggestions.push({
        priority: 6,
        type: 'create_campaign',
        description: 'Ajouter une campagne de ciblage produit pour diversifier les sources de trafic',
        estimatedImpact: 'Ouvre un nouveau canal d\'acquisition complémentaire',
        details: { campaignType: 'sponsoredProducts', targetingType: 'manual', type: 'product_targeting' },
      });
    }

    return suggestions;
  }

  // ── Next Campaign Recommendations ─────────────────────────────

  generateNextCampaignRecommendations(
    scenario: Scenario,
    ctx: ScenarioContext,
  ): NextCampaignRecommendation[] {
    const recs: NextCampaignRecommendation[] = [];

    if (scenario === Scenario.A) {
      recs.push(
        {
          campaignType: 'sponsoredProducts',
          targetingType: 'auto',
          estimatedDailyBudget: DEFAULT_AUTO_CAMPAIGN_BUDGET,
          rationale: 'Les campagnes auto sont essentielles pour identifier les termes de recherche convertissants',
          priority: 'high',
        },
        {
          campaignType: 'sponsoredProducts',
          targetingType: 'manual',
          matchTypes: ['exact'],
          estimatedDailyBudget: DEFAULT_MANUAL_CAMPAIGN_BUDGET,
          rationale: 'Les campagnes exact capturent les recherches à forte intention',
          priority: 'high',
        },
        {
          campaignType: 'sponsoredProducts',
          targetingType: 'manual',
          matchTypes: ['phrase'],
          estimatedDailyBudget: DEFAULT_MANUAL_CAMPAIGN_BUDGET,
          rationale: 'Les campagnes phrase élargissent la couverture de façon ciblée',
          priority: 'medium',
        },
      );
    }

    // SB recommendation si éligible
    if (scenario === Scenario.C) {
      const sbCheck = this.checkSBEligibility(ctx);
      if (sbCheck.eligible) {
        recs.push({
          campaignType: 'sponsoredBrands',
          targetingType: 'manual',
          keywords: sbCheck.winnerKeywords,
          estimatedDailyBudget: DEFAULT_SB_CAMPAIGN_BUDGET,
          rationale: `${sbCheck.winnerKeywords.length} WINNERs qualifiés + ventes suffisantes pour SB`,
          priority: 'high',
        });
      }
    }

    return recs;
  }

  // ── Diversification Opportunities ─────────────────────────────

  generateDiversificationOpportunities(
    ctx: ScenarioContext,
  ): DiversificationOpportunity[] {
    const opps: DiversificationOpportunity[] = [];
    const allRoles = new Set(ctx.campaignRoles.flatMap((cr) => cr.roles));

    // Product targeting
    const hasProductTargeting = allRoles.has('diversification') ||
      ctx.campaigns.some((c) => c.adGroups.some((ag) => ag.targets.length > 0));
    opps.push({
      type: 'product_targeting',
      description: 'Cibler des livres similaires via le product targeting',
      prerequisites: ['Au moins 1 campagne profitable', '>30 jours de données'],
      met: hasProductTargeting,
      priority: hasProductTargeting ? 'low' : 'medium',
    });

    // Video / SB
    const sbCheck = this.checkSBEligibility(ctx);
    opps.push({
      type: 'video_campaign',
      description: 'Campagne SB Video pour augmenter la visibilité de marque',
      prerequisites: [
        `${SB_MIN_WINNER_KEYWORDS}+ WINNER keywords`,
        `Ventes > ${SB_MIN_MONTHLY_SALES}€/mois`,
        `SP profitable > ${SB_MIN_PROFITABLE_DAYS} jours`,
      ],
      met: sbCheck.eligible,
      estimatedBudget: DEFAULT_SB_CAMPAIGN_BUDGET,
      priority: sbCheck.eligible ? 'high' : 'low',
    });

    // Multi match types
    const matchTypes = new Set<string>();
    for (const c of ctx.campaigns) {
      for (const ag of c.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state !== 'archived') matchTypes.add(kw.matchType);
        }
      }
    }
    const hasMultiMatch = matchTypes.size >= 2;
    opps.push({
      type: 'multi_match_type',
      description: 'Utiliser plusieurs types de correspondance (exact, phrase, broad)',
      prerequisites: ['Au moins 2 types de correspondance actifs'],
      met: hasMultiMatch,
      priority: hasMultiMatch ? 'low' : 'medium',
    });

    return opps;
  }

  // ── SB Eligibility Check ──────────────────────────────────────

  private checkSBEligibility(ctx: ScenarioContext): {
    eligible: boolean;
    winnerKeywords: string[];
    reasons: string[];
  } {
    const breakEvenAcos = ctx.bookContext.acosTarget || 40;
    const acosThreshold = breakEvenAcos * SB_ACOS_FACTOR;

    // Collecter les WINNERs qualifiés
    const qualifiedWinners: string[] = [];
    for (const [, insights] of ctx.entityInsightsMap) {
      for (const insight of insights) {
        if (
          insight.diagnosisCode === 'winner' &&
          insight.summaryFacts.acos != null &&
          insight.summaryFacts.acos < acosThreshold
        ) {
          qualifiedWinners.push(insight.entityKey);
        }
      }
    }

    const reasons: string[] = [];
    if (qualifiedWinners.length < SB_MIN_WINNER_KEYWORDS) {
      reasons.push(`Seulement ${qualifiedWinners.length}/${SB_MIN_WINNER_KEYWORDS} WINNERs qualifiés`);
    }

    // Vérifier les ventes mensuelles
    let totalMonthlySales = 0;
    for (const [, insights] of ctx.entityInsightsMap) {
      for (const insight of insights) {
        const periodDays = insight.summaryFacts.periodDays || 14;
        totalMonthlySales += (insight.summaryFacts.sales / periodDays) * 30;
      }
    }
    if (totalMonthlySales < SB_MIN_MONTHLY_SALES) {
      reasons.push(`Ventes mensuelles estimées ${totalMonthlySales.toFixed(0)}€ < ${SB_MIN_MONTHLY_SALES}€`);
    }

    return {
      eligible: qualifiedWinners.length >= SB_MIN_WINNER_KEYWORDS && totalMonthlySales >= SB_MIN_MONTHLY_SALES && reasons.length === 0,
      winnerKeywords: qualifiedWinners,
      reasons,
    };
  }
}
