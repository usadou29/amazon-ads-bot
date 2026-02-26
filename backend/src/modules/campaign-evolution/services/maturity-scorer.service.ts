import { Injectable, Logger } from '@nestjs/common';
import {
  type CampaignWithEntities,
  type CampaignRoleAssignment,
  type EntityInsight,
  type CampaignMacroStrategy,
  type MaturityBreakdown,
  type CampaignRole,
} from '../campaign-evolution.types';
import { MATURITY_MAX, DIVERSIFICATION_POINTS } from '../constants';

@Injectable()
export class MaturityScorerService {
  private readonly logger = new Logger(MaturityScorerService.name);

  /**
   * Calcule le score de maturité global [0-100] avec ventilation
   */
  computeMaturityScore(
    campaigns: CampaignWithEntities[],
    campaignRoles: CampaignRoleAssignment[],
    entityInsightsMap: Map<string, EntityInsight[]>,
    duplicationScore: number,
    chaosScore: number,
    namingConsistency: number,
  ): MaturityBreakdown & { total: number } {
    const structure = this.computeStructureScore(campaignRoles, chaosScore, namingConsistency);
    const winnersExploited = this.computeWinnersExploitedScore(campaigns, entityInsightsMap);
    const diversification = this.computeDiversificationScore(campaigns, entityInsightsMap);
    const stability = this.computeStabilityScore(duplicationScore, chaosScore);

    const total = Math.min(
      Math.round(structure + winnersExploited + diversification + stability),
      100,
    );

    return {
      structure: Math.round(structure * 10) / 10,
      winnersExploited: Math.round(winnersExploited * 10) / 10,
      diversification: Math.round(diversification * 10) / 10,
      stability: Math.round(stability * 10) / 10,
      total,
    };
  }

  // ── Structure (30 pts max) ────────────────────────────────────

  private computeStructureScore(
    campaignRoles: CampaignRoleAssignment[],
    chaosScore: number,
    namingConsistency: number,
  ): number {
    // 1. Couverture des 4 rôles (+10 pts)
    const allRoles = new Set<CampaignRole>();
    for (const cr of campaignRoles) {
      for (const role of cr.roles) {
        allRoles.add(role);
      }
    }
    allRoles.delete('unknown');
    const expectedRoles = 4; // exploration, validation, amplification, diversification
    const rolesCoverage = Math.min(allRoles.size / expectedRoles, 1);
    const rolesScore = rolesCoverage * 10;

    // 2. Cohérence nommage (+10 pts)
    const namingScore = (1 - namingConsistency) * 10;

    // 3. Anti-chaos (+10 pts)
    const antiChaosScore = (1 - chaosScore) * 10;

    return Math.min(rolesScore + namingScore + antiChaosScore, MATURITY_MAX.structure);
  }

  // ── Winners Exploited (30 pts max) ────────────────────────────

  private computeWinnersExploitedScore(
    campaigns: CampaignWithEntities[],
    entityInsightsMap: Map<string, EntityInsight[]>,
  ): number {
    // Collecter tous les WINNERs
    const winners: Array<{ entityKey: string; campaignId: string }> = [];
    for (const [campaignId, insights] of entityInsightsMap) {
      for (const insight of insights) {
        if (insight.diagnosisCode === 'winner') {
          winners.push({ entityKey: insight.entityKey, campaignId });
        }
      }
    }

    if (winners.length === 0) return 0;

    // 1. WINNERs dans des campagnes exact (+15 pts)
    let winnersInExact = 0;
    for (const w of winners) {
      const campaign = campaigns.find((c) => c.id === w.campaignId);
      if (!campaign) continue;

      const hasExactKw = campaign.adGroups.some((ag) =>
        ag.keywords.some(
          (k) => k.matchType === 'exact' && k.state !== 'archived',
        ),
      );
      if (hasExactKw) winnersInExact++;
    }
    const exactCoverage = winnersInExact / winners.length;
    const exactScore = exactCoverage * 15;

    // 2. Enchères suffisantes (+10 pts) — basé sur la présence de bids >0
    let winnersWithBids = 0;
    for (const w of winners) {
      const campaign = campaigns.find((c) => c.id === w.campaignId);
      if (!campaign) continue;
      const hasBid = campaign.adGroups.some((ag) =>
        ag.keywords.some((k) => k.bid != null && Number(k.bid) > 0),
      );
      if (hasBid) winnersWithBids++;
    }
    const bidScore = (winnersWithBids / winners.length) * 10;

    // 3. Campagnes dédiées pour winners (+5 pts)
    const dedicatedScore = exactCoverage > 0.5 ? 5 : exactCoverage > 0.2 ? 2.5 : 0;

    return Math.min(exactScore + bidScore + dedicatedScore, MATURITY_MAX.winnersExploited);
  }

  // ── Diversification (20 pts max) ──────────────────────────────

  private computeDiversificationScore(
    campaigns: CampaignWithEntities[],
    entityInsightsMap: Map<string, EntityInsight[]>,
  ): number {
    let score = 0;

    // 1. Product targeting (+7 pts)
    const hasProductTargeting = campaigns.some((c) =>
      c.adGroups.some((ag) => ag.targets.some((t) => t.state !== 'archived')),
    );
    if (hasProductTargeting) score += DIVERSIFICATION_POINTS.hasProductTargeting;

    // 2. Multiple match types (+7 pts)
    const matchTypes = new Set<string>();
    for (const c of campaigns) {
      for (const ag of c.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state !== 'archived') matchTypes.add(kw.matchType);
        }
      }
    }
    if (matchTypes.size >= 2) score += DIVERSIFICATION_POINTS.hasMultipleMatchTypes;

    // 3. SB éligible (+6 pts)
    const hasSB = campaigns.some((c) => c.campaignType === 'sponsoredBrands' && c.state !== 'archived');
    if (hasSB) {
      score += DIVERSIFICATION_POINTS.sbEligible;
    } else {
      // Vérifier l'éligibilité potentielle (bonus partiel si presque éligible)
      let winnerCount = 0;
      for (const [, insights] of entityInsightsMap) {
        winnerCount += insights.filter((i) => i.diagnosisCode === 'winner').length;
      }
      if (winnerCount >= 3) score += DIVERSIFICATION_POINTS.sbEligible * 0.5; // demi-points si éligible mais pas créé
    }

    return Math.min(score, MATURITY_MAX.diversification);
  }

  // ── Stability (20 pts max) ────────────────────────────────────

  private computeStabilityScore(duplicationScore: number, chaosScore: number): number {
    const antiChaos = (1 - chaosScore) * 10;
    const antiDuplication = (1 - duplicationScore) * 10;

    return Math.min(antiChaos + antiDuplication, MATURITY_MAX.stability);
  }
}
