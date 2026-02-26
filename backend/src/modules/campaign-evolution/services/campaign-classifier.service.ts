import { Injectable, Logger } from '@nestjs/common';
import {
  type CampaignWithEntities,
  type CampaignRole,
  type CampaignRoleAssignment,
  type EntityInsight,
  type CampaignMacroStrategy,
  type MacroStrategyCode,
} from '../campaign-evolution.types';
import { AMPLIFICATION_WINNER_RATIO } from '../constants';

@Injectable()
export class CampaignClassifierService {
  private readonly logger = new Logger(CampaignClassifierService.name);

  /**
   * Classifie chaque campagne en 1+ rôles (exploration, validation, amplification, diversification, unknown)
   */
  classifyCampaigns(
    campaigns: CampaignWithEntities[],
    entityInsightsMap: Map<string, EntityInsight[]>,
    macroStrategies: Map<string, CampaignMacroStrategy>,
  ): CampaignRoleAssignment[] {
    return campaigns
      .filter((c) => c.state !== 'archived')
      .map((campaign) => {
        const insights = entityInsightsMap.get(campaign.id) || [];
        const macro = macroStrategies.get(campaign.id);
        const roles = this.assignRoles(campaign, insights);
        const confidence = this.computeConfidence(campaign, insights);

        return {
          campaignId: campaign.id,
          campaignName: campaign.name,
          roles,
          macroStrategy: (macro?.macroStrategyCode || 'no_signal_yet') as MacroStrategyCode,
          confidence,
        };
      });
  }

  /**
   * Assigne les rôles à une campagne
   */
  private assignRoles(campaign: CampaignWithEntities, insights: EntityInsight[]): CampaignRole[] {
    const roles: CampaignRole[] = [];

    // Exploration : Auto OU manual avec broad
    if (this.isExploration(campaign)) {
      roles.push('exploration');
    }

    // Validation : manual avec phrase
    if (this.isValidation(campaign)) {
      roles.push('validation');
    }

    // Amplification : exact match avec WINNERs
    if (this.isAmplification(campaign, insights)) {
      roles.push('amplification');
    }

    // Diversification : product targets OU SB/SD
    if (this.isDiversification(campaign)) {
      roles.push('diversification');
    }

    // Fallback
    if (roles.length === 0) {
      roles.push('unknown');
    }

    return roles;
  }

  private isExploration(campaign: CampaignWithEntities): boolean {
    // Auto campaigns
    if (campaign.targetingType === 'auto') return true;

    // Manual avec broad keywords
    if (campaign.targetingType === 'manual') {
      const allKws = campaign.adGroups.flatMap((ag) =>
        ag.keywords.filter((k) => k.state !== 'archived'),
      );
      const broadCount = allKws.filter((k) => k.matchType === 'broad').length;
      // Si la majorité des keywords sont broad
      return allKws.length > 0 && broadCount / allKws.length > 0.5;
    }

    return false;
  }

  private isValidation(campaign: CampaignWithEntities): boolean {
    if (campaign.targetingType !== 'manual') return false;

    const allKws = campaign.adGroups.flatMap((ag) =>
      ag.keywords.filter((k) => k.state !== 'archived'),
    );
    if (allKws.length === 0) return false;

    const phraseCount = allKws.filter((k) => k.matchType === 'phrase').length;
    return phraseCount / allKws.length > 0.5;
  }

  private isAmplification(campaign: CampaignWithEntities, insights: EntityInsight[]): boolean {
    if (campaign.targetingType !== 'manual') return false;

    // Vérifier si la campagne a des exact keywords
    const allKws = campaign.adGroups.flatMap((ag) =>
      ag.keywords.filter((k) => k.state !== 'archived'),
    );
    const exactCount = allKws.filter((k) => k.matchType === 'exact').length;
    if (exactCount === 0) return false;

    // Compter les WINNERs parmi les insights
    const winnerCount = insights.filter((i) => i.diagnosisCode === 'winner').length;
    const totalEntities = insights.length;

    if (totalEntities === 0) return false;

    return winnerCount / totalEntities >= AMPLIFICATION_WINNER_RATIO;
  }

  private isDiversification(campaign: CampaignWithEntities): boolean {
    // SB ou SD
    if (campaign.campaignType === 'sponsoredBrands' || campaign.campaignType === 'sponsoredDisplay') {
      return true;
    }

    // Product targeting
    const hasTargets = campaign.adGroups.some((ag) =>
      ag.targets.some((t) => t.state !== 'archived'),
    );

    return hasTargets;
  }

  /**
   * Calcule la confiance de la classification [0-1]
   * Plus il y a de données (keywords, impressions), plus on est confiant
   */
  private computeConfidence(campaign: CampaignWithEntities, insights: EntityInsight[]): number {
    const kwCount = campaign.adGroups.reduce(
      (sum, ag) => sum + ag.keywords.filter((k) => k.state !== 'archived').length,
      0,
    );

    // Confiance basée sur le nombre d'entités et la présence de données
    const entityScore = Math.min(kwCount / 10, 1); // Max at 10 keywords
    const insightScore = insights.length > 0 ? Math.min(insights.length / 5, 1) : 0;

    return Math.round(((entityScore + insightScore) / 2) * 100) / 100;
  }
}
