import { Injectable, Logger } from '@nestjs/common';
import {
  GapType,
  type GapSeverity,
  type StructuralGap,
  type TopFocusContext,
  type CampaignPlanType,
  type CampaignWithEntities,
  type EntityInsight,
} from '../campaign-evolution.types';
import {
  GAP_SEVERITY_MATRIX,
  GAP_CLEANUP_DUPLICATION_THRESHOLD,
  GAP_CLEANUP_CHAOS_THRESHOLD,
  SB_MIN_WINNER_KEYWORDS,
  SB_ACOS_FACTOR,
  SB_MIN_MONTHLY_SALES,
} from '../constants';

const SEVERITY_ORDER: Record<GapSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

@Injectable()
export class GapDetectorService {
  private readonly logger = new Logger(GapDetectorService.name);

  /**
   * Detect all structural gaps in the book's advertising portfolio.
   * Returns gaps sorted by severity (critical first).
   */
  detectGaps(ctx: TopFocusContext): StructuralGap[] {
    const gaps: StructuralGap[] = [];
    const lifecycle = ctx.bookContext.lifecyclePhase || 'launch';

    const explorationGap = this.detectExplorationGap(ctx, lifecycle);
    if (explorationGap) gaps.push(explorationGap);

    const validationGap = this.detectValidationGap(ctx, lifecycle);
    if (validationGap) gaps.push(validationGap);

    const amplificationGap = this.detectAmplificationGap(ctx, lifecycle);
    if (amplificationGap) gaps.push(amplificationGap);

    const diversificationGap = this.detectDiversificationGap(ctx, lifecycle);
    if (diversificationGap) gaps.push(diversificationGap);

    const videoGap = this.detectVideoGap(ctx, lifecycle);
    if (videoGap) gaps.push(videoGap);

    const cleanupGap = this.detectCleanupGap(ctx, lifecycle);
    if (cleanupGap) gaps.push(cleanupGap);

    // Sort by severity: critical > high > medium > low
    gaps.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    this.logger.debug(`Detected ${gaps.length} gaps for book ${ctx.bookContext.id}: ${gaps.map(g => g.type).join(', ')}`);
    return gaps;
  }

  // ── 1. GAP_EXPLORATION: No Auto campaign ───────────────────────

  private detectExplorationGap(ctx: TopFocusContext, lifecycle: string): StructuralGap | null {
    const hasAuto = ctx.campaigns.some(
      c => c.state !== 'archived' && c.targetingType === 'auto',
    );

    if (hasAuto) return null;

    // Also check roles — maybe there's a campaign acting as exploration
    const hasExplorationRole = ctx.campaignRoles.some(r => r.roles.includes('exploration'));
    if (hasExplorationRole) return null;

    const severity = this.getSeverity(GapType.GAP_EXPLORATION, lifecycle);

    return {
      type: GapType.GAP_EXPLORATION,
      severity,
      label: 'Campagne de découverte manquante',
      explanation: 'Aucune campagne Auto n\'est active. Sans campagne Auto, Amazon ne peut pas tester de mots-clés pour ton livre.',
      campaignsToCreate: ['SP_AUTO'],
    };
  }

  // ── 2. GAP_VALIDATION: No Exact or Phrase campaign ────────────

  private detectValidationGap(ctx: TopFocusContext, lifecycle: string): StructuralGap | null {
    const hasExact = this.hasMatchType(ctx.campaigns, 'exact');
    const hasPhrase = this.hasMatchType(ctx.campaigns, 'phrase');

    if (hasExact || hasPhrase) return null;

    // Also check roles
    const hasValidationRole = ctx.campaignRoles.some(r => r.roles.includes('validation'));
    if (hasValidationRole) return null;

    // Don't flag if 0 campaigns (that's GAP_EXPLORATION territory)
    if (ctx.campaigns.length === 0) return null;

    const severity = this.getSeverity(GapType.GAP_VALIDATION, lifecycle);
    const campaignsToCreate: CampaignPlanType[] = ['SP_MANUAL_EXACT'];

    return {
      type: GapType.GAP_VALIDATION,
      severity,
      label: 'Campagne de validation manquante',
      explanation: 'Aucune campagne Exact ou Phrase n\'est active. Les termes performants ne sont pas ciblés précisément.',
      campaignsToCreate,
    };
  }

  // ── 3. GAP_AMPLIFICATION: Winners exist but not isolated ──────

  private detectAmplificationGap(ctx: TopFocusContext, lifecycle: string): StructuralGap | null {
    const winnerKeywordTexts = this.getWinnerKeywordTexts(ctx);

    if (winnerKeywordTexts.length === 0) return null;

    // Check if winners are already in a dedicated exact campaign
    const winnersInDedicatedExact = this.areWinnersInDedicatedExact(ctx, winnerKeywordTexts);
    if (winnersInDedicatedExact) return null;

    const severity = this.getSeverity(GapType.GAP_AMPLIFICATION, lifecycle);

    return {
      type: GapType.GAP_AMPLIFICATION,
      severity,
      label: `${winnerKeywordTexts.length} gagnant${winnerKeywordTexts.length > 1 ? 's' : ''} non isolé${winnerKeywordTexts.length > 1 ? 's' : ''}`,
      explanation: `Tu as ${winnerKeywordTexts.length} mot${winnerKeywordTexts.length > 1 ? 's' : ''}-clé${winnerKeywordTexts.length > 1 ? 's' : ''} gagnant${winnerKeywordTexts.length > 1 ? 's' : ''} qui ne sont pas isolés en campagne Exact dédiée.`,
      campaignsToCreate: ['SP_MANUAL_EXACT'],
    };
  }

  // ── 4. GAP_DIVERSIFICATION: No product targeting ──────────────

  private detectDiversificationGap(ctx: TopFocusContext, lifecycle: string): StructuralGap | null {
    // Only relevant from scale onwards
    if (lifecycle === 'launch') return null;

    const hasProductTargeting = ctx.campaigns.some(
      c => c.state !== 'archived' && c.adGroups.some(ag => ag.targets.length > 0),
    );

    if (hasProductTargeting) return null;

    // Also check roles
    const hasDiversificationRole = ctx.campaignRoles.some(r => r.roles.includes('diversification'));
    if (hasDiversificationRole) return null;

    // Need at least 1 campaign to consider diversification
    if (ctx.campaigns.length === 0) return null;

    const severity = this.getSeverity(GapType.GAP_DIVERSIFICATION, lifecycle);

    return {
      type: GapType.GAP_DIVERSIFICATION,
      severity,
      label: 'Product targeting manquant',
      explanation: 'Aucune campagne ne cible les fiches de livres similaires. C\'est un trafic très qualifié à explorer.',
      campaignsToCreate: ['SP_PRODUCT'],
    };
  }

  // ── 5. GAP_VIDEO: Eligible for SB Video but none exists ───────

  private detectVideoGap(ctx: TopFocusContext, lifecycle: string): StructuralGap | null {
    // Check SB eligibility conditions
    const winnerCount = ctx.context.totalWinnerKeywords;
    if (winnerCount < SB_MIN_WINNER_KEYWORDS) return null;

    const breakEvenAcos = ctx.bookContext.acosTarget;
    const avgAcos = ctx.context.avgAcos;
    if (avgAcos === undefined || avgAcos <= 0 || avgAcos > breakEvenAcos * SB_ACOS_FACTOR) return null;

    const monthlySales = ctx.context.totalSales30d;
    if (!monthlySales || monthlySales < SB_MIN_MONTHLY_SALES) return null;

    // Check if SB already exists (approximation: look for non-SP campaigns)
    const hasSB = ctx.campaigns.some(
      c => c.state !== 'archived' && c.campaignType !== 'sponsoredProducts',
    );
    if (hasSB) return null;

    const severity = this.getSeverity(GapType.GAP_VIDEO, lifecycle);

    return {
      type: GapType.GAP_VIDEO,
      severity,
      label: 'Éligible Sponsored Brands',
      explanation: `Tu as ${winnerCount} gagnants avec un ACoS moyen de ${avgAcos.toFixed(0)}% et ${monthlySales.toFixed(0)}€/mois de ventes. Tu peux lancer une campagne SB Video.`,
      campaignsToCreate: ['SB_VIDEO'],
    };
  }

  // ── 6. GAP_CLEANUP: High duplication or chaos ────────────────

  private detectCleanupGap(ctx: TopFocusContext, lifecycle: string): StructuralGap | null {
    const highDuplication = ctx.duplicationScore > GAP_CLEANUP_DUPLICATION_THRESHOLD;
    const highChaos = ctx.chaosScore > GAP_CLEANUP_CHAOS_THRESHOLD;

    if (!highDuplication && !highChaos) return null;

    const parts: string[] = [];
    if (highDuplication) parts.push(`${(ctx.duplicationScore * 100).toFixed(0)}% de mots-clés en doublon`);
    if (highChaos) parts.push(`score de désordre à ${(ctx.chaosScore * 100).toFixed(0)}%`);

    const severity = this.getSeverity(GapType.GAP_CLEANUP, lifecycle);

    return {
      type: GapType.GAP_CLEANUP,
      severity,
      label: 'Nettoyage nécessaire',
      explanation: `Structure à optimiser : ${parts.join(', ')}.`,
      campaignsToCreate: [], // Cleanup doesn't create, it restructures
    };
  }

  // ── Helpers ──────────────────────────────────────────────────

  private getSeverity(gapType: GapType, lifecycle: string): GapSeverity {
    const matrix = GAP_SEVERITY_MATRIX[gapType];
    if (!matrix) return 'medium';
    return matrix[lifecycle] || matrix['launch'] || 'medium';
  }

  private hasMatchType(campaigns: CampaignWithEntities[], matchType: string): boolean {
    return campaigns.some(c =>
      c.state !== 'archived' &&
      c.adGroups.some(ag =>
        ag.keywords.some(kw => kw.matchType === matchType && kw.state !== 'archived'),
      ),
    );
  }

  private getWinnerKeywordTexts(ctx: TopFocusContext): string[] {
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

  private areWinnersInDedicatedExact(ctx: TopFocusContext, winnerTexts: string[]): boolean {
    if (winnerTexts.length === 0) return true;

    const winnerSet = new Set(winnerTexts.map(t => t.toLowerCase()));

    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      const exactKws = c.adGroups.flatMap(ag =>
        ag.keywords.filter(k => k.matchType === 'exact' && k.state !== 'archived'),
      );
      const matchingWinners = exactKws.filter(k => winnerSet.has(k.keywordText.toLowerCase()));
      // If at least 50% of winners are in exact in this campaign, consider them covered
      if (matchingWinners.length >= winnerSet.size * 0.5) return true;
    }

    return false;
  }
}
