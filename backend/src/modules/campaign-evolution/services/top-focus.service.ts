import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  Scenario,
  GapType,
  type TopFocus,
  type TopFocusContext,
  type CreationPlan,
  type CampaignToCreate,
  type CampaignPlanType,
  type BiddingStrategy,
  type TopFocusTheme,
  type CtaIntent,
  type StructuralGap,
  type PauseStrategy,
  type CampaignToPause,
} from '../campaign-evolution.types';
import {
  LIFECYCLE_DEFAULTS,
  BID_GUARDS,
} from '../constants';

/** Gap types that justify intent=CREATE */
const CREATE_WORTHY_GAPS = new Set([
  GapType.GAP_EXPLORATION,
  GapType.GAP_VALIDATION,
  GapType.GAP_AMPLIFICATION,
]);

@Injectable()
export class TopFocusService {
  private readonly logger = new Logger(TopFocusService.name);

  // ── Top Focus Computation ─────────────────────────────────────

  computeTopFocus(ctx: TopFocusContext): TopFocus {
    // First: compute scenario-based focus
    let focus: TopFocus;

    switch (ctx.scenario) {
      case Scenario.A:
        focus = this.focusForA(ctx);
        break;
      case Scenario.B:
        focus = this.focusForB(ctx);
        break;
      case Scenario.C:
        focus = this.focusForC(ctx);
        break;
      case Scenario.STABLE:
      default:
        focus = this.focusForStable(ctx);
        break;
    }

    // Second: if STABLE + gaps exist → override intent
    if (ctx.scenario === Scenario.STABLE && ctx.gaps && ctx.gaps.length > 0) {
      focus = this.overrideStableWithGaps(ctx, focus);
    }

    return focus;
  }

  // ── Creation Plan (only when intent=CREATE) ───────────────────

  generateCreationPlan(ctx: TopFocusContext): CreationPlan | undefined {
    const topFocus = this.computeTopFocus(ctx);
    if (topFocus.primaryCta.intent !== 'CREATE') return undefined;

    const planId = randomUUID();
    const campaignsToCreate = this.buildCampaignsToCreate(ctx);

    if (campaignsToCreate.length === 0) return undefined;

    const fingerprint = this.computePlanFingerprint(ctx, campaignsToCreate);
    const gaps = (ctx.gaps || []).map(g => g.type);

    // Build pause strategy if CLEANUP gap + rebuild scenario
    const pauseStrategy = this.buildPauseStrategy(ctx);

    const plan: CreationPlan = { planId, fingerprint, campaignsToCreate, gaps, pauseStrategy };

    // Link plan to CTA
    topFocus.primaryCta.planId = planId;

    return plan;
  }

  // ── Gap-Aware STABLE Override ───────────────────────────────

  private overrideStableWithGaps(ctx: TopFocusContext, originalFocus: TopFocus): TopFocus {
    const gaps = ctx.gaps || [];
    const criticalOrHigh = gaps.filter(g => g.severity === 'critical' || g.severity === 'high');

    if (criticalOrHigh.length === 0) return originalFocus;

    const hasCreateWorthy = criticalOrHigh.some(g => CREATE_WORTHY_GAPS.has(g.type));
    const hasCleanupOnly = criticalOrHigh.every(g => g.type === GapType.GAP_CLEANUP);

    if (hasCreateWorthy) {
      // Find the top priority gap to drive the message
      const topGap = criticalOrHigh.find(g => CREATE_WORTHY_GAPS.has(g.type)) || criticalOrHigh[0];
      return this.focusFromGap(ctx, topGap, 'CREATE');
    }

    if (hasCleanupOnly) {
      const topGap = criticalOrHigh[0];
      return this.focusFromGap(ctx, topGap, 'CLEANUP');
    }

    return originalFocus;
  }

  private focusFromGap(ctx: TopFocusContext, gap: StructuralGap, intent: CtaIntent): TopFocus {
    const themeMap: Record<string, TopFocusTheme> = {
      [GapType.GAP_EXPLORATION]: 'VISIBILITE',
      [GapType.GAP_VALIDATION]: 'CONVERSION',
      [GapType.GAP_AMPLIFICATION]: 'RENTABILITE',
      [GapType.GAP_DIVERSIFICATION]: 'VISIBILITE',
      [GapType.GAP_VIDEO]: 'RENTABILITE',
      [GapType.GAP_CLEANUP]: 'STRUCTURE',
    };

    const ctaLabelMap: Record<string, Record<string, string>> = {
      CREATE: {
        [GapType.GAP_EXPLORATION]: 'Créer mes campagnes recommandées',
        [GapType.GAP_VALIDATION]: 'Créer mes campagnes recommandées',
        [GapType.GAP_AMPLIFICATION]: 'Isoler mes gagnants',
        default: 'Créer les campagnes recommandées',
      },
      CLEANUP: {
        [GapType.GAP_CLEANUP]: 'Repartir proprement',
        default: 'Nettoyer la structure',
      },
    };

    const ctaLabels = ctaLabelMap[intent] || ctaLabelMap['CREATE'];
    const ctaLabel = ctaLabels[gap.type] || ctaLabels['default'];

    const evidence = [
      { label: gap.label, value: gap.explanation.slice(0, 60) },
    ];

    // Add second evidence if available
    if (ctx.context.totalCampaigns > 0) {
      evidence.push({ label: 'Campagnes actives', value: `${ctx.context.totalCampaigns}` });
    }

    return {
      theme: themeMap[gap.type] || 'VISIBILITE',
      title: gap.label,
      summary: gap.explanation,
      evidence: evidence.slice(0, 2),
      primaryCta: {
        label: ctaLabel,
        intent,
      },
    };
  }

  // ── Scenario A: No campaigns → VISIBILITE + CREATE ────────────

  private focusForA(ctx: TopFocusContext): TopFocus {
    return {
      theme: 'VISIBILITE',
      title: 'Lancer tes premières campagnes',
      summary: 'Tu n\'as pas encore de publicité pour ce livre. On va créer une structure de base pour commencer à collecter des données et générer des ventes.',
      evidence: [
        { label: 'Campagnes actives', value: '0' },
        { label: 'Visibilité actuelle', value: 'Aucune' },
      ],
      primaryCta: {
        label: 'Créer les campagnes recommandées',
        intent: 'CREATE',
      },
    };
  }

  // ── Scenario B: Chaos → STRUCTURE + CLEANUP or CREATE ─────────

  private focusForB(ctx: TopFocusContext): TopFocus {
    const hasBasicStructure = this.hasBasicCampaignStructure(ctx);
    const intent: CtaIntent = hasBasicStructure ? 'CLEANUP' : 'CREATE';

    const evidence = [];
    if (ctx.duplicationScore > 0.4) {
      evidence.push({
        label: 'Mots-clés en doublon',
        value: `${(ctx.duplicationScore * 100).toFixed(0)}% de cannibalisation`,
      });
    }
    if (ctx.chaosScore > 0.5) {
      evidence.push({
        label: 'Score de désordre',
        value: `${(ctx.chaosScore * 100).toFixed(0)}% — structure à simplifier`,
      });
    }
    if (evidence.length === 0) {
      evidence.push({ label: 'Campagnes', value: `${ctx.context.totalCampaigns} actives` });
    }

    const finalEvidence = evidence.slice(0, 2);

    if (intent === 'CLEANUP') {
      return {
        theme: 'STRUCTURE',
        title: 'Nettoyer la structure publicitaire',
        summary: 'Tes campagnes se marchent dessus. On va consolider pour que chaque euro aille au bon endroit.',
        evidence: finalEvidence,
        primaryCta: {
          label: 'Nettoyer la structure',
          intent: 'CLEANUP',
        },
      };
    }

    return {
      theme: 'STRUCTURE',
      title: 'Reconstruire une base solide',
      summary: 'Ta structure publicitaire est désorganisée et il manque des campagnes clés. On va recréer un socle propre.',
      evidence: finalEvidence,
      primaryCta: {
        label: 'Créer les campagnes recommandées',
        intent: 'CREATE',
      },
    };
  }

  // ── Scenario C: Winners → RENTABILITE/AMPLIFY ─────────────────

  private focusForC(ctx: TopFocusContext): TopFocus {
    const winnerCount = ctx.context.totalWinnerKeywords;
    const needsExactCampaign = this.needsDedicatedExactCampaign(ctx);
    const intent: CtaIntent = needsExactCampaign ? 'CREATE' : 'AMPLIFY';

    const evidence = [
      {
        label: 'Mots-clés gagnants',
        value: `${winnerCount} WINNER${winnerCount > 1 ? 's' : ''} identifié${winnerCount > 1 ? 's' : ''}`,
      },
    ];

    const avgAcos = ctx.context.avgAcos;
    if (avgAcos !== undefined && avgAcos > 0) {
      evidence.push({
        label: 'ACoS moyen 30j',
        value: `${avgAcos.toFixed(0)}%`,
      });
    } else if (ctx.context.totalSpend30d) {
      evidence.push({
        label: 'Dépense 30j',
        value: `${ctx.context.totalSpend30d.toFixed(0)}€`,
      });
    }

    if (intent === 'CREATE') {
      return {
        theme: 'RENTABILITE',
        title: 'Isoler tes gagnants en campagne Exact',
        summary: `Tu as ${winnerCount} mot${winnerCount > 1 ? 's' : ''}-clé${winnerCount > 1 ? 's' : ''} qui convertissent bien mais ne sont pas encore isolés en Exact. On va les pousser pour scaler.`,
        evidence: evidence.slice(0, 2),
        primaryCta: {
          label: 'Créer les campagnes recommandées',
          intent: 'CREATE',
        },
      };
    }

    return {
      theme: 'RENTABILITE',
      title: 'Accélérer tes gagnants',
      summary: `Tu as ${winnerCount} mot${winnerCount > 1 ? 's' : ''}-clé${winnerCount > 1 ? 's' : ''} gagnant${winnerCount > 1 ? 's' : ''} déjà en Exact. On va augmenter les enchères et la visibilité pour maximiser les ventes.`,
      evidence: evidence.slice(0, 2),
      primaryCta: {
        label: 'Accélérer les gagnants',
        intent: 'AMPLIFY',
      },
    };
  }

  // ── Scenario STABLE → OBSERVE ─────────────────────────────────

  private focusForStable(ctx: TopFocusContext): TopFocus {
    const evidence = [
      { label: 'Campagnes actives', value: `${ctx.context.totalCampaigns}` },
    ];

    if (ctx.maturityScore > 0) {
      evidence.push({ label: 'Score maturité', value: `${ctx.maturityScore}/100` });
    }

    return {
      theme: 'VISIBILITE',
      title: 'Tes campagnes tournent bien',
      summary: `Tes ${ctx.context.totalCampaigns} campagnes sont stables. Continue de surveiller et optimise à la marge.`,
      evidence: evidence.slice(0, 2),
      primaryCta: {
        label: 'Rien à faire maintenant — surveiller',
        intent: 'OBSERVE',
      },
    };
  }

  // ── Build campaigns to create ─────────────────────────────────

  private buildCampaignsToCreate(ctx: TopFocusContext): CampaignToCreate[] {
    const bookTitle = (ctx.bookContext.title || ctx.bookContext.asin || 'Livre').slice(0, 25);
    const lifecycle = (ctx.bookContext.lifecyclePhase || 'launch') as keyof typeof LIFECYCLE_DEFAULTS;
    const defaults = LIFECYCLE_DEFAULTS[lifecycle] || LIFECYCLE_DEFAULTS.launch;

    // Gap-driven path: when STABLE + gaps exist, build from gaps
    if (ctx.scenario === Scenario.STABLE && ctx.gaps && ctx.gaps.length > 0) {
      return this.buildFromGaps(ctx, bookTitle, defaults);
    }

    // Scenario-driven path (original logic)
    return this.buildFromScenario(ctx, bookTitle, defaults);
  }

  private buildFromGaps(
    ctx: TopFocusContext,
    bookTitle: string,
    defaults: (typeof LIFECYCLE_DEFAULTS)[keyof typeof LIFECYCLE_DEFAULTS],
  ): CampaignToCreate[] {
    const result: CampaignToCreate[] = [];
    const gaps = ctx.gaps || [];

    for (const gap of gaps) {
      if (gap.severity === 'low') continue; // Only act on critical/high/medium

      switch (gap.type) {
        case GapType.GAP_EXPLORATION: {
          result.push({
            name: `${bookTitle}-SP-Auto`,
            type: 'SP_AUTO',
            targetingMode: 'AUTO',
            dailyBudget: defaults.auto.dailyBudget,
            biddingStrategy: 'DOWN_ONLY',
            notesWhy: 'Campagne de découverte : Amazon teste les mots-clés pour toi.',
          });
          break;
        }
        case GapType.GAP_VALIDATION: {
          const seeds = this.extractWinnerKeywordTexts(ctx);
          const seedsOrInferred = seeds.length > 0 ? seeds : this.inferSeedKeywords(ctx);
          result.push({
            name: `${bookTitle}-SP-Exact`,
            type: 'SP_MANUAL_EXACT',
            targetingMode: 'MANUAL',
            dailyBudget: defaults.manual.dailyBudget,
            biddingStrategy: 'DOWN_ONLY',
            seedKeywords: seedsOrInferred,
            notesWhy: 'Cible les termes précis à forte intention d\'achat.',
          });
          break;
        }
        case GapType.GAP_AMPLIFICATION: {
          const winnerTexts = this.extractWinnerKeywordTexts(ctx);
          if (winnerTexts.length > 0) {
            result.push({
              name: `${bookTitle}-SP-Winners-Exact`,
              type: 'SP_MANUAL_EXACT',
              targetingMode: 'MANUAL',
              dailyBudget: Math.min(defaults.manual.dailyBudget * 1.5, defaults.maxDailyBudget),
              biddingStrategy: 'UP_DOWN',
              seedKeywords: winnerTexts,
              notesWhy: `Isole tes ${winnerTexts.length} gagnants pour maximiser le retour.`,
            });
          }
          break;
        }
        case GapType.GAP_DIVERSIFICATION: {
          result.push({
            name: `${bookTitle}-SP-Product`,
            type: 'SP_PRODUCT',
            targetingMode: 'MANUAL',
            dailyBudget: defaults.manual.dailyBudget,
            biddingStrategy: 'DOWN_ONLY',
            notesWhy: 'Cible les fiches de livres similaires pour capter du trafic qualifié.',
          });
          break;
        }
        case GapType.GAP_VIDEO: {
          result.push({
            name: `${bookTitle}-SB-Video`,
            type: 'SB_VIDEO',
            targetingMode: 'MANUAL',
            dailyBudget: Math.min(12, defaults.maxDailyBudget),
            biddingStrategy: 'DOWN_ONLY',
            seedKeywords: this.extractWinnerKeywordTexts(ctx),
            notesWhy: 'Lance une campagne Sponsored Brands Video pour booster ta visibilité.',
          });
          break;
        }
        // GAP_CLEANUP doesn't create campaigns
        default:
          break;
      }
    }

    return result;
  }

  private buildFromScenario(
    ctx: TopFocusContext,
    bookTitle: string,
    defaults: (typeof LIFECYCLE_DEFAULTS)[keyof typeof LIFECYCLE_DEFAULTS],
  ): CampaignToCreate[] {
    const lifecycle = (ctx.bookContext.lifecyclePhase || 'launch') as keyof typeof LIFECYCLE_DEFAULTS;
    const result: CampaignToCreate[] = [];

    if (ctx.scenario === Scenario.A) {
      result.push({
        name: `${bookTitle}-SP-Auto`,
        type: 'SP_AUTO',
        targetingMode: 'AUTO',
        dailyBudget: defaults.auto.dailyBudget,
        biddingStrategy: 'DOWN_ONLY',
        notesWhy: 'Campagne de découverte : Amazon teste les mots-clés pour toi.',
      });

      result.push({
        name: `${bookTitle}-SP-Exact`,
        type: 'SP_MANUAL_EXACT',
        targetingMode: 'MANUAL',
        dailyBudget: defaults.manual.dailyBudget,
        biddingStrategy: 'DOWN_ONLY',
        seedKeywords: this.inferSeedKeywords(ctx),
        notesWhy: 'Cible les termes précis à forte intention d\'achat.',
      });

      if (lifecycle === 'scale' || lifecycle === 'evergreen') {
        result.push({
          name: `${bookTitle}-SP-Phrase`,
          type: 'SP_MANUAL_PHRASE',
          targetingMode: 'MANUAL',
          dailyBudget: defaults.manual.dailyBudget,
          biddingStrategy: 'DOWN_ONLY',
          seedKeywords: this.inferSeedKeywords(ctx),
          notesWhy: 'Élargit la couverture tout en restant pertinent.',
        });
      }
    } else if (ctx.scenario === Scenario.B) {
      const existingTypes = this.getExistingCampaignTypes(ctx);

      if (!existingTypes.has('auto')) {
        result.push({
          name: `${bookTitle}-SP-Auto`,
          type: 'SP_AUTO',
          targetingMode: 'AUTO',
          dailyBudget: defaults.auto.dailyBudget,
          biddingStrategy: 'DOWN_ONLY',
          notesWhy: 'Il te manque une campagne Auto pour la découverte.',
        });
      }

      if (!existingTypes.has('exact')) {
        result.push({
          name: `${bookTitle}-SP-Exact`,
          type: 'SP_MANUAL_EXACT',
          targetingMode: 'MANUAL',
          dailyBudget: defaults.manual.dailyBudget,
          biddingStrategy: 'DOWN_ONLY',
          seedKeywords: this.extractWinnerKeywordTexts(ctx),
          notesWhy: 'Une campagne Exact dédiée pour tes meilleurs termes.',
        });
      }
    } else if (ctx.scenario === Scenario.C) {
      const winnerTexts = this.extractWinnerKeywordTexts(ctx);

      if (winnerTexts.length > 0 && this.needsDedicatedExactCampaign(ctx)) {
        result.push({
          name: `${bookTitle}-SP-Winners-Exact`,
          type: 'SP_MANUAL_EXACT',
          targetingMode: 'MANUAL',
          dailyBudget: Math.min(defaults.manual.dailyBudget * 1.5, defaults.maxDailyBudget),
          biddingStrategy: 'UP_DOWN',
          seedKeywords: winnerTexts,
          notesWhy: `Isole tes ${winnerTexts.length} gagnants pour maximiser le retour.`,
        });
      }

      if (!this.hasProductTargeting(ctx)) {
        result.push({
          name: `${bookTitle}-SP-Product`,
          type: 'SP_PRODUCT',
          targetingMode: 'MANUAL',
          dailyBudget: defaults.manual.dailyBudget,
          biddingStrategy: 'DOWN_ONLY',
          notesWhy: 'Cible les fiches de livres similaires pour capter du trafic qualifié.',
        });
      }
    }

    return result;
  }

  // ── Pause Strategy (for rebuild/cleanup) ─────────────────────

  private buildPauseStrategy(ctx: TopFocusContext): PauseStrategy | undefined {
    const hasCleanupGap = (ctx.gaps || []).some(
      g => g.type === GapType.GAP_CLEANUP && (g.severity === 'critical' || g.severity === 'high'),
    );

    if (!hasCleanupGap) return undefined;

    // Identify campaigns to pause: those classified as 'unknown' or with very poor performance
    const campaignsToPause: CampaignToPause[] = [];
    let totalBudgetToSave = 0;

    for (const cr of ctx.campaignRoles) {
      if (!cr.roles.includes('unknown')) continue;

      const campaign = ctx.campaigns.find(c => c.id === cr.campaignId);
      if (!campaign || campaign.state === 'archived') continue;

      // Harvest keywords and ASINs from this campaign
      const harvestedKeywords: string[] = [];
      const harvestedAsins: string[] = [];

      for (const ag of campaign.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state !== 'archived') harvestedKeywords.push(kw.keywordText);
        }
        for (const tg of ag.targets) {
          if (tg.state !== 'archived' && tg.expressionType === 'asinSameAs') {
            const asin = typeof tg.expression === 'string' ? tg.expression : tg.expression?.value;
            if (asin) harvestedAsins.push(asin);
          }
        }
      }

      campaignsToPause.push({
        campaignId: campaign.id,
        name: campaign.name,
        reason: 'Campagne sans rôle clair — budget mieux utilisé dans les nouvelles campagnes.',
        harvestedKeywords: [...new Set(harvestedKeywords)],
        harvestedAsins: [...new Set(harvestedAsins)],
      });

      totalBudgetToSave += campaign.dailyBudget || 0;
    }

    if (campaignsToPause.length === 0) return undefined;

    return { campaignsToPause, totalBudgetToSave };
  }

  // ── Plan fingerprint ──────────────────────────────────────────

  private computePlanFingerprint(ctx: TopFocusContext, campaigns: CampaignToCreate[]): string {
    const data = JSON.stringify({
      bookId: ctx.bookContext.id,
      lifecycle: ctx.bookContext.lifecyclePhase,
      scenario: ctx.scenario,
      gaps: (ctx.gaps || []).map(g => g.type).sort(),
      campaigns: campaigns.map(c => ({
        type: c.type,
        targetingMode: c.targetingMode,
        keywords: (c.seedKeywords || []).slice().sort(),
        asins: (c.seedAsins || []).slice().sort(),
      })),
    });
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  // ── Helpers ───────────────────────────────────────────────────

  private hasBasicCampaignStructure(ctx: TopFocusContext): boolean {
    const types = this.getExistingCampaignTypes(ctx);
    return types.has('auto') && (types.has('exact') || types.has('phrase'));
  }

  private getExistingCampaignTypes(ctx: TopFocusContext): Set<string> {
    const types = new Set<string>();
    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      if (c.targetingType === 'auto') types.add('auto');
      for (const ag of c.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state !== 'archived') types.add(kw.matchType);
        }
        if (ag.targets.length > 0) types.add('product');
      }
    }
    return types;
  }

  private needsDedicatedExactCampaign(ctx: TopFocusContext): boolean {
    const winnerKeys = new Set<string>();
    for (const [, insights] of ctx.entityInsightsMap) {
      for (const insight of insights) {
        if (insight.diagnosisCode === 'winner') winnerKeys.add(insight.entityKey);
      }
    }

    if (winnerKeys.size === 0) return false;

    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      const exactKws = c.adGroups.flatMap(ag =>
        ag.keywords.filter(k => k.matchType === 'exact' && k.state !== 'archived'),
      );
      const winnerInExact = exactKws.filter(k => winnerKeys.has(`keyword:${k.id}`));
      if (winnerInExact.length >= winnerKeys.size * 0.5) return false;
    }

    return true;
  }

  private hasProductTargeting(ctx: TopFocusContext): boolean {
    return ctx.campaigns.some(c =>
      c.state !== 'archived' && c.adGroups.some(ag => ag.targets.length > 0),
    );
  }

  private extractWinnerKeywordTexts(ctx: TopFocusContext): string[] {
    const texts: string[] = [];
    for (const c of ctx.campaigns) {
      for (const ag of c.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state === 'archived') continue;
          const key = `keyword:${kw.id}`;
          const insights = ctx.entityInsightsMap.get(c.id) || [];
          if (insights.some(i => i.entityKey === key && i.diagnosisCode === 'winner')) {
            texts.push(kw.keywordText);
          }
        }
      }
    }
    return [...new Set(texts)];
  }

  private inferSeedKeywords(ctx: TopFocusContext): string[] {
    const title = ctx.bookContext.title || '';
    const words = title
      .toLowerCase()
      .replace(/[^a-zàâéèêëïîôùûüç\s-]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);
    return words.length > 0 ? words.slice(0, 5) : [];
  }
}
