import { Injectable, Logger } from '@nestjs/common';
import {
  Scenario,
  GapType,
  type RoadmapWeek,
  type RoadmapContext,
  type StructuralGap,
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
   * Génère une roadmap 4 semaines conditionnelle au scénario.
   * Si des gaps sont détectés (STABLE override), utilise le gap-driven path.
   */
  generateRoadmap(ctx: RoadmapContext): RoadmapWeek[] {
    // Gap-driven roadmap when STABLE + gaps exist
    if (ctx.scenario === Scenario.STABLE && ctx.gaps && ctx.gaps.length > 0) {
      const criticalOrHigh = ctx.gaps.filter(g => g.severity === 'critical' || g.severity === 'high');
      if (criticalOrHigh.length > 0) {
        return this.roadmapFromGaps(ctx, ctx.gaps);
      }
    }

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

  // ── Gap-driven Roadmap ──────────────────────────────────────

  private roadmapFromGaps(ctx: RoadmapContext, gaps: StructuralGap[]): RoadmapWeek[] {
    const bookTitle = ctx.bookContext.title || 'Livre';
    const weeks: RoadmapWeek[] = [];

    // Group gaps by severity into weeks
    const critical = gaps.filter(g => g.severity === 'critical');
    const high = gaps.filter(g => g.severity === 'high');
    const medium = gaps.filter(g => g.severity === 'medium');

    // Week 1: Critical + high gaps
    const week1Gaps = [...critical, ...high.slice(0, 2)];
    if (week1Gaps.length > 0) {
      weeks.push({
        week: 1,
        title: 'Priorité — combler les lacunes critiques',
        actions: week1Gaps.map(gap => this.gapToRoadmapAction(gap, bookTitle)),
      });
    }

    // Week 2: Remaining high + medium
    const remainingHigh = critical.length > 0 ? high : high.slice(2);
    const week2Gaps = [...remainingHigh, ...medium.slice(0, 2)];
    if (week2Gaps.length > 0) {
      weeks.push({
        week: weeks.length + 1,
        title: 'Consolidation — renforcer la structure',
        actions: week2Gaps.map(gap => this.gapToRoadmapAction(gap, bookTitle)),
      });
    }

    // Week 3: Negative keywords + fine-tune
    weeks.push({
      week: weeks.length + 1,
      title: 'Optimisation — négatifs + ajustements',
      actions: [{
        type: 'negative_keyword',
        priority: 'medium' as const,
        estimatedDurationHours: 1,
        why: 'Les nouvelles campagnes vont générer des termes non pertinents.',
        impact: 'Économie de 10-15% du budget sur les termes non convertissants.',
        details: { action: 'Analyser les termes de recherche et ajouter des négatifs' },
      }],
    });

    // Week 4: Monitoring
    weeks.push({
      week: weeks.length + 1,
      title: 'Bilan — évaluer les résultats',
      actions: [{
        type: 'bid_adjustment',
        priority: 'medium' as const,
        estimatedDurationHours: 1,
        why: 'Les premières données des nouvelles campagnes permettent des ajustements.',
        impact: 'Optimisation des enchères basée sur les performances réelles.',
        details: { action: 'Bilan des nouvelles campagnes et ajustement des enchères' },
      }],
    });

    return weeks;
  }

  private gapToRoadmapAction(gap: StructuralGap, bookTitle: string) {
    const actionMap: Record<string, { type: string; why: string; impact: string; details: Record<string, any> }> = {
      [GapType.GAP_EXPLORATION]: {
        type: 'create_campaign',
        why: 'Sans campagne Auto, Amazon ne peut pas tester de mots-clés pour ton livre.',
        impact: 'Premiers clics et données de recherche sous 48h.',
        details: { name: `${bookTitle}-Auto`, campaignType: 'sponsoredProducts', targetingType: 'auto', dailyBudget: DEFAULT_AUTO_CAMPAIGN_BUDGET },
      },
      [GapType.GAP_VALIDATION]: {
        type: 'create_campaign',
        why: 'Sans campagne Exact, tu ne peux pas cibler précisément les termes qui convertissent.',
        impact: 'Ciblage précis des termes à forte intention d\'achat.',
        details: { name: `${bookTitle}-Exact`, campaignType: 'sponsoredProducts', targetingType: 'manual', matchTypes: ['exact'], dailyBudget: DEFAULT_MANUAL_CAMPAIGN_BUDGET },
      },
      [GapType.GAP_AMPLIFICATION]: {
        type: 'create_campaign',
        why: 'Tes gagnants méritent une campagne dédiée pour maximiser le retour.',
        impact: 'Augmentation de 20-30% des impressions sur tes meilleurs termes.',
        details: { name: `${bookTitle}-Winners-Exact`, campaignType: 'sponsoredProducts', targetingType: 'manual', matchTypes: ['exact'] },
      },
      [GapType.GAP_DIVERSIFICATION]: {
        type: 'create_campaign',
        why: 'Le product targeting cible les lecteurs de livres similaires — trafic très qualifié.',
        impact: 'Nouvelle source de ventes complémentaire.',
        details: { name: `${bookTitle}-Product`, campaignType: 'sponsoredProducts', targetingType: 'manual' },
      },
      [GapType.GAP_VIDEO]: {
        type: 'create_campaign',
        why: 'Tu es éligible SB Video — c\'est un format très performant pour les livres.',
        impact: 'Visibilité de marque accrue et taux de clic supérieur.',
        details: { name: `${bookTitle}-SB-Video`, campaignType: 'sponsoredBrands' },
      },
      [GapType.GAP_CLEANUP]: {
        type: 'consolidate_adgroup',
        why: 'Trop de doublons ou de désordre dans la structure actuelle.',
        impact: 'Réduction du CPC et clarification de la performance par campagne.',
        details: { action: 'Consolider les mots-clés dupliqués et restructurer' },
      },
    };

    const mapped = actionMap[gap.type] || {
      type: 'bid_adjustment',
      why: gap.explanation,
      impact: 'Amélioration de la structure publicitaire.',
      details: {},
    };

    return {
      type: mapped.type,
      priority: (gap.severity === 'critical' || gap.severity === 'high') ? 'high' as const : 'medium' as const,
      estimatedDurationHours: mapped.type === 'create_campaign' ? 1 : 2,
      why: mapped.why,
      impact: mapped.impact,
      details: mapped.details,
    };
  }

  // ── Scenario A : No Campaigns → Setup progressif ──────────────

  private roadmapForA(ctx: RoadmapContext): RoadmapWeek[] {
    const bookTitle = ctx.bookContext.title || 'Livre';

    return [
      {
        week: 1,
        title: 'Lancement — campagne Auto + Broad',
        actions: [
          {
            type: 'create_campaign',
            priority: 'high',
            estimatedDurationHours: 1,
            why: 'Sans campagne Auto, Amazon ne peut pas tester de mots-clés pour toi.',
            impact: 'Premiers clics et données de recherche sous 48h.',
            details: {
              name: `${bookTitle}-Auto-Exploration`,
              campaignType: 'sponsoredProducts',
              targetingType: 'auto',
              dailyBudget: DEFAULT_AUTO_CAMPAIGN_BUDGET,
            },
          },
        ],
      },
      {
        week: 2,
        title: 'Récolte — extraire les termes qui convertissent',
        actions: [
          {
            type: 'create_campaign',
            priority: 'high',
            estimatedDurationHours: 2,
            why: 'Les premiers résultats Auto révèlent les termes performants.',
            impact: 'Capturer les recherches à forte intention dans une campagne dédiée.',
            details: {
              name: `${bookTitle}-Exact-Validation`,
              campaignType: 'sponsoredProducts',
              targetingType: 'manual',
              matchTypes: ['exact'],
              dailyBudget: DEFAULT_MANUAL_CAMPAIGN_BUDGET,
            },
          },
          {
            type: 'negative_keyword',
            priority: 'medium',
            estimatedDurationHours: 0.5,
            why: 'Les termes non pertinents gaspillent du budget en Auto.',
            impact: 'Économie de 10-20% du budget Auto.',
            details: {
              campaignTarget: 'auto',
            },
          },
        ],
      },
      {
        week: 3,
        title: 'Validation — campagne Phrase pour élargir',
        actions: [
          {
            type: 'create_campaign',
            priority: 'medium',
            estimatedDurationHours: 1.5,
            why: 'Le Phrase couvre les variantes proches de tes meilleurs termes.',
            impact: 'Découverte de nouvelles requêtes pertinentes à moindre coût.',
            details: {
              name: `${bookTitle}-Phrase-Validation`,
              campaignType: 'sponsoredProducts',
              targetingType: 'manual',
              matchTypes: ['phrase'],
              dailyBudget: DEFAULT_MANUAL_CAMPAIGN_BUDGET,
            },
          },
        ],
      },
      {
        week: 4,
        title: 'Bilan — optimiser les enchères',
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'medium',
            estimatedDurationHours: 1,
            why: '3 semaines de données permettent des décisions éclairées.',
            impact: 'Réduction de l\'ACoS de 5-15% par ajustements ciblés.',
            details: {
              action: 'Analyser les premiers résultats et ajuster les enchères',
            },
          },
        ],
      },
    ];
  }

  // ── Scenario B : Chaos → Consolidation progressive ────────────

  private roadmapForB(ctx: RoadmapContext): RoadmapWeek[] {
    const unknownCampaigns = ctx.campaignRoles.filter((r) => r.roles.includes('unknown'));

    return [
      {
        week: 1,
        title: 'Consolidation — éliminer les doublons',
        actions: [
          {
            type: 'consolidate_adgroup',
            priority: 'high',
            estimatedDurationHours: 2,
            why: 'Des mots-clés identiques dans plusieurs campagnes se font concurrence.',
            impact: 'Réduction du CPC moyen de 10-15%.',
            details: {
              action: 'Identifier et consolider les mots-clés dupliqués entre campagnes',
            },
          },
          ...(unknownCampaigns.length > 0
            ? [{
                type: 'pause_campaign' as const,
                priority: 'high' as const,
                estimatedDurationHours: 0.5,
                why: `${unknownCampaigns.length} campagne(s) n'ont pas de rôle clair et gaspillent du budget.`,
                impact: 'Économie immédiate du budget mal alloué.',
                details: {
                  campaignIds: unknownCampaigns.map((c) => c.campaignId),
                  action: `Mettre en pause ${unknownCampaigns.length} campagne(s) au rôle indéfini`,
                },
              }]
            : []),
        ],
      },
      {
        week: 2,
        title: 'Nettoyage — renommer + réallouer les budgets',
        actions: [
          {
            type: 'rename_campaign',
            priority: 'medium',
            estimatedDurationHours: 1,
            why: 'Des noms incohérents rendent impossible le suivi quotidien.',
            impact: 'Clarté immédiate sur le rôle de chaque campagne.',
            details: {
              action: 'Renommer selon le format {Livre}-{MatchType}-{Rôle}',
            },
          },
          {
            type: 'restructure',
            priority: 'medium',
            estimatedDurationHours: 2,
            why: 'Des ad groups mélangés diluent la pertinence des enchères.',
            impact: 'Meilleur Quality Score et enchères plus précises.',
            details: {
              action: 'Réorganiser les ad groups : 1 thème = 1 ad group',
            },
          },
        ],
      },
      {
        week: 3,
        title: 'Surveillance — valider les changements',
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'medium',
            estimatedDurationHours: 1,
            why: 'Il faut vérifier que la restructuration améliore les performances.',
            impact: 'Détection rapide des régressions et corrections.',
            details: {
              action: 'Surveiller les métriques post-restructuration et ajuster les budgets',
            },
          },
        ],
      },
      {
        week: 4,
        title: 'Transition — préparer la croissance',
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'low',
            estimatedDurationHours: 1,
            why: 'Si la structure est propre, des winners vont émerger.',
            impact: 'Passage en mode croissance (scénario C) si des gagnants apparaissent.',
            details: {
              action: 'Fine-tuner les enchères ; préparer l\'expansion si des winners émergent',
            },
          },
        ],
      },
    ];
  }

  // ── Scenario C : Winners → Amplification + Diversification ────

  private roadmapForC(ctx: RoadmapContext): RoadmapWeek[] {
    // Count winners for context
    const winnerCount = ctx.entityInsightsMap
      ? [...ctx.entityInsightsMap.values()].flat().filter(i => i.diagnosisCode === 'winner').length
      : 0;

    return [
      {
        week: 1,
        title: 'Amplification — isoler les gagnants en Exact',
        actions: [
          {
            type: 'create_campaign',
            priority: 'high',
            estimatedDurationHours: 2,
            why: `Tes ${winnerCount || 'N'} gagnants méritent une campagne dédiée avec enchères maximisées.`,
            impact: 'Augmentation des impressions de 20-30% sur tes meilleurs termes.',
            details: {
              action: 'Isoler les mots-clés WINNER dans une campagne exact dédiée',
              campaignType: 'sponsoredProducts',
              targetingType: 'manual',
              matchTypes: ['exact'],
            },
          },
        ],
      },
      {
        week: 2,
        title: 'Protection — négatifs + boost enchères',
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'high',
            estimatedDurationHours: 1,
            why: 'Les gagnants doivent gagner plus d\'enchères pour maximiser les ventes.',
            impact: `+${BID_INCREASE_PERCENT}% de visibilité sur les termes validés.`,
            details: {
              action: `Augmenter les enchères de ${BID_INCREASE_PERCENT}% sur les WINNERs en exact`,
            },
          },
          {
            type: 'negative_keyword',
            priority: 'medium',
            estimatedDurationHours: 0.5,
            why: 'Sans négatifs, tes campagnes Auto/Broad cannibalisent la campagne Exact.',
            impact: 'Élimination de la compétition interne — budget mieux utilisé.',
            details: {
              action: 'Ajouter les WINNERs comme négatifs dans les campagnes broad/phrase/auto',
            },
          },
        ],
      },
      {
        week: 3,
        title: 'Diversification — product targeting',
        actions: [
          {
            type: 'create_campaign',
            priority: 'medium',
            estimatedDurationHours: 1.5,
            why: 'Le product targeting cible les lecteurs de livres similaires — trafic très qualifié.',
            impact: 'Nouvelle source de ventes sans cannibaliser tes campagnes actuelles.',
            details: {
              action: 'Créer une campagne product targeting sur livres similaires',
              campaignType: 'sponsoredProducts',
              targetingType: 'manual',
            },
          },
        ],
      },
      {
        week: 4,
        title: 'Bilan — évaluer SB/Video',
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'medium',
            estimatedDurationHours: 1,
            why: 'Après 3 semaines d\'amplification, il faut évaluer l\'éligibilité SB.',
            impact: 'Ouverture du canal Sponsored Brands si les métriques le justifient.',
            details: {
              action: 'Évaluer l\'éligibilité SB Video et préparer la prochaine phase',
            },
          },
        ],
      },
    ];
  }

  // ── Scenario STABLE → Maintenance + micro-optimisations ───────

  private roadmapForStable(ctx: RoadmapContext): RoadmapWeek[] {
    const allRoles = new Set(ctx.campaignRoles.flatMap((cr) => cr.roles));

    return [
      {
        week: 1,
        title: 'Monitoring — vérifier les tendances',
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'medium',
            estimatedDurationHours: 1,
            why: 'Même en pilotage stable, les tendances évoluent chaque semaine.',
            impact: 'Détection précoce de baisse de performance.',
            details: {
              action: 'Vérifier les KPI clés : ACoS, CPC moyen, taux de conversion',
            },
          },
        ],
      },
      {
        week: 2,
        title: 'Micro-optimisations — affiner les négatifs',
        actions: [
          {
            type: 'negative_keyword',
            priority: 'medium',
            estimatedDurationHours: 1,
            why: 'De nouveaux termes non pertinents apparaissent en continu.',
            impact: 'Économie de 3-5% du budget mensuel.',
            details: {
              action: 'Analyser les termes de recherche et ajouter des négatifs',
            },
          },
        ],
      },
      {
        week: 3,
        title: 'Placements — tester les ajustements',
        actions: [
          ...(!allRoles.has('diversification')
            ? [{
                type: 'create_campaign' as const,
                priority: 'medium' as const,
                estimatedDurationHours: 2,
                why: 'Tu n\'as pas encore de product targeting — c\'est une source de trafic complémentaire.',
                impact: 'Nouveau canal d\'acquisition sans risque pour les campagnes existantes.',
                details: {
                  action: 'Tester le product targeting sur des livres similaires',
                  campaignType: 'sponsoredProducts',
                  targetingType: 'manual',
                },
              }]
            : [{
                type: 'bid_adjustment' as const,
                priority: 'low' as const,
                estimatedDurationHours: 0.5,
                why: 'Les placements (Top of Search vs Product Pages) impactent fortement le CPC.',
                impact: 'Optimisation du ROI par canal de diffusion.',
                details: {
                  action: 'Ajuster les modificateurs de placement (Top of Search, Product Pages)',
                },
              }]),
        ],
      },
      {
        week: 4,
        title: 'Bilan mensuel — score de maturité',
        actions: [
          {
            type: 'bid_adjustment',
            priority: 'low',
            estimatedDurationHours: 1,
            why: 'Un bilan mensuel permet d\'identifier les prochains axes de croissance.',
            impact: 'Vision claire des progrès et des opportunités restantes.',
            details: {
              action: 'Bilan mensuel : évaluer la progression du maturity score',
            },
          },
        ],
      },
    ];
  }
}
