import { Injectable, Logger } from '@nestjs/common';
import {
  Scenario,
  type RoadmapWeek,
  type RoadmapContext,
  type StructuralSuggestion,
} from '../campaign-evolution.types';
import {
  DEFAULT_AUTO_CAMPAIGN_BUDGET,
  DEFAULT_MANUAL_CAMPAIGN_BUDGET,
  DEFAULT_SB_CAMPAIGN_BUDGET,
  BID_INCREASE_PERCENT,
} from '../constants';

@Injectable()
export class RoadmapGeneratorService {
  private readonly logger = new Logger(RoadmapGeneratorService.name);

  /**
   * Génère une roadmap 4 semaines basée sur le scénario et les suggestions
   */
  generateRoadmap(ctx: RoadmapContext): RoadmapWeek[] {
    switch (ctx.scenario) {
      case Scenario.A:
        return this.roadmapForA(ctx);
      case Scenario.B:
        return this.roadmapForB(ctx);
      case Scenario.C:
        return this.roadmapForC(ctx);
      case Scenario.STABLE:
        return this.roadmapForStable(ctx);
      default:
        return [];
    }
  }

  // ── Scenario A : No Campaigns ─────────────────────────────────

  private roadmapForA(ctx: RoadmapContext): RoadmapWeek[] {
    const bookTitle = ctx.bookContext.title || 'Livre';

    return [
      {
        week: 1,
        actions: [
          {
            type: 'create_campaign',
            priority: 'high',
            estimatedDurationHours: 1,
            details: {
              name: `${bookTitle}-Auto-Exploration`,
              campaignType: 'sponsoredProducts',
              targetingType: 'auto',
              dailyBudget: DEFAULT_AUTO_CAMPAIGN_BUDGET,
              rationale: 'Campagne auto pour collecter les premiers termes de recherche',
            },
          },
        ],
      },
      {
        week: 2,
        actions: [
          {
            type: 'create_campaign',
            priority: 'high',
            estimatedDurationHours: 2,
            details: {
              name: `${bookTitle}-Exact-Validation`,
              campaignType: 'sponsoredProducts',
              targetingType: 'manual',
              matchTypes: ['exact'],
              dailyBudget: DEFAULT_MANUAL_CAMPAIGN_BUDGET,
              rationale: 'Campagne exact pour les mots-clés à forte intention identifiés',
            },
          },
          {
            type: 'negative_keyword',
            priority: 'medium',
            estimatedDurationHours: 0.5,
            details: {
              campaignTarget: 'auto',
              rationale: 'Ajouter des mots-clés négatifs à la campagne auto pour éviter le trafic non pertinent',
            },
          },
        ],
      },
      {
        week: 3,
        actions: [
          {
            type: 'create_campaign',
            priority: 'medium',
            estimatedDurationHours: 1.5,
            details: {
              name: `${bookTitle}-Phrase-Validation`,
              campaignType: 'sponsoredProducts',
              targetingType: 'manual',
              matchTypes: ['phrase'],
              dailyBudget: DEFAULT_MANUAL_CAMPAIGN_BUDGET,
              rationale: 'Campagne phrase pour élargir la couverture de façon ciblée',
            },
          },
        ],
      },
      {
        week: 4,
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'medium',
            estimatedDurationHours: 1,
            details: {
              action: 'Analyser les premiers résultats et ajuster les enchères',
              rationale: 'Après ~3 semaines, les premiers signaux permettent d\'optimiser',
            },
          },
        ],
      },
    ];
  }

  // ── Scenario B : Chaos Detected ───────────────────────────────

  private roadmapForB(ctx: RoadmapContext): RoadmapWeek[] {
    const unknownCampaigns = ctx.campaignRoles.filter((r) => r.roles.includes('unknown'));

    return [
      {
        week: 1,
        actions: [
          {
            type: 'consolidate_adgroup',
            priority: 'high',
            estimatedDurationHours: 2,
            details: {
              action: 'Identifier et consolider les mots-clés dupliqués entre campagnes',
              rationale: 'Éliminer la compétition interne pour réduire le CPC moyen',
            },
          },
          ...(unknownCampaigns.length > 0
            ? [
                {
                  type: 'pause_campaign' as const,
                  priority: 'high' as const,
                  estimatedDurationHours: 0.5,
                  details: {
                    campaignIds: unknownCampaigns.map((c) => c.campaignId),
                    action: `Mettre en pause ${unknownCampaigns.length} campagne(s) au rôle indéfini`,
                    rationale: 'Simplifier le portefeuille avant restructuration',
                  },
                },
              ]
            : []),
        ],
      },
      {
        week: 2,
        actions: [
          {
            type: 'rename_campaign',
            priority: 'medium',
            estimatedDurationHours: 1,
            details: {
              action: 'Renommer toutes les campagnes selon le format {Livre}-{MatchType}-{Rôle}',
              rationale: 'Convention de nommage cohérente pour faciliter la gestion',
            },
          },
          {
            type: 'restructure',
            priority: 'medium',
            estimatedDurationHours: 2,
            details: {
              action: 'Réorganiser les ad groups pour avoir 1 thème = 1 ad group',
              rationale: 'Structure claire pour un meilleur contrôle des enchères',
            },
          },
        ],
      },
      {
        week: 3,
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'medium',
            estimatedDurationHours: 1,
            details: {
              action: 'Surveiller les métriques post-restructuration et ajuster les budgets',
              rationale: 'Vérifier que la restructuration améliore les performances',
            },
          },
        ],
      },
      {
        week: 4,
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'low',
            estimatedDurationHours: 1,
            details: {
              action: 'Fine-tuner les enchères ; préparer l\'expansion si des winners émergent',
              rationale: 'Transition vers le scénario C si des WINNERs apparaissent',
            },
          },
        ],
      },
    ];
  }

  // ── Scenario C : Winners Exist ────────────────────────────────

  private roadmapForC(ctx: RoadmapContext): RoadmapWeek[] {
    return [
      {
        week: 1,
        actions: [
          {
            type: 'create_campaign',
            priority: 'high',
            estimatedDurationHours: 2,
            details: {
              action: 'Isoler les mots-clés WINNER dans une campagne exact dédiée',
              campaignType: 'sponsoredProducts',
              targetingType: 'manual',
              matchTypes: ['exact'],
              rationale: 'Contrôle maximum des enchères sur les termes les plus rentables',
            },
          },
        ],
      },
      {
        week: 2,
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'high',
            estimatedDurationHours: 1,
            details: {
              action: `Augmenter les enchères de ${BID_INCREASE_PERCENT}% sur les WINNERs en exact`,
              rationale: 'Capturer plus de parts de marché sur les termes validés',
            },
          },
          {
            type: 'negative_keyword',
            priority: 'medium',
            estimatedDurationHours: 0.5,
            details: {
              action: 'Ajouter les WINNERs comme négatifs dans les campagnes broad/phrase/auto',
              rationale: 'Éviter la cannibalisation entre campagnes',
            },
          },
        ],
      },
      {
        week: 3,
        actions: [
          {
            type: 'create_campaign',
            priority: 'medium',
            estimatedDurationHours: 1.5,
            details: {
              action: 'Créer des campagnes complémentaires phrase/broad autour des thèmes des WINNERs',
              rationale: 'Découvrir de nouvelles variations de recherche liées aux termes gagnants',
            },
          },
        ],
      },
      {
        week: 4,
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'medium',
            estimatedDurationHours: 1,
            details: {
              action: 'Monitorer l\'ACoS des nouvelles campagnes ; évaluer l\'éligibilité SB',
              rationale: 'Préparer la prochaine phase de croissance (SB/Video si éligible)',
            },
          },
        ],
      },
    ];
  }

  // ── Scenario STABLE ───────────────────────────────────────────

  private roadmapForStable(ctx: RoadmapContext): RoadmapWeek[] {
    const allRoles = new Set(ctx.campaignRoles.flatMap((cr) => cr.roles));

    return [
      {
        week: 1,
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'medium',
            estimatedDurationHours: 1,
            details: {
              action: 'Optimiser les enchères sur les entités avec le meilleur potentiel',
              rationale: 'Ajustements incrémentaux pour améliorer l\'ACoS global',
            },
          },
        ],
      },
      {
        week: 2,
        actions: [
          {
            type: 'negative_keyword',
            priority: 'medium',
            estimatedDurationHours: 1,
            details: {
              action: 'Analyser les termes de recherche et ajouter des négatifs',
              rationale: 'Réduire le gaspillage sur les termes non convertissants',
            },
          },
        ],
      },
      {
        week: 3,
        actions: [
          ...(!allRoles.has('diversification')
            ? [
                {
                  type: 'create_campaign' as const,
                  priority: 'medium' as const,
                  estimatedDurationHours: 2,
                  details: {
                    action: 'Tester le product targeting sur des livres similaires',
                    campaignType: 'sponsoredProducts',
                    targetingType: 'manual',
                    rationale: 'Diversifier les sources de trafic',
                  },
                },
              ]
            : [
                {
                  type: 'bid_adjustment' as const,
                  priority: 'low' as const,
                  estimatedDurationHours: 0.5,
                  details: {
                    action: 'Surveiller les métriques clés et ajuster si nécessaire',
                    rationale: 'Maintien des performances stables',
                  },
                },
              ]),
        ],
      },
      {
        week: 4,
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'low',
            estimatedDurationHours: 1,
            details: {
              action: 'Bilan mensuel : évaluer la progression du maturity score',
              rationale: 'Identifier les prochains axes d\'amélioration',
            },
          },
        ],
      },
    ];
  }
}
