import { Injectable, Logger } from '@nestjs/common';
import {
  type CampaignWithEntities,
  type StructuralIssue,
  type CampaignRoleAssignment,
  type CampaignRole,
} from '../campaign-evolution.types';
import {
  CHAOS_WEIGHTS,
  IDEAL_CAMPAIGN_COUNT_MIN,
  IDEAL_CAMPAIGN_COUNT_MAX,
} from '../constants';

@Injectable()
export class StructureAnalyzerService {
  private readonly logger = new Logger(StructureAnalyzerService.name);

  // ── Duplication Score ─────────────────────────────────────────

  /**
   * Calcule le ratio de mots-clés apparaissant dans 2+ campagnes
   * 0 = isolation parfaite, 1 = tout est dupliqué
   */
  computeDuplicationScore(campaigns: CampaignWithEntities[]): number {
    const keywordOccurrences = new Map<string, Set<string>>();

    for (const campaign of campaigns) {
      for (const ag of campaign.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state === 'archived') continue;
          const text = kw.keywordText.toLowerCase().trim();
          if (!keywordOccurrences.has(text)) {
            keywordOccurrences.set(text, new Set());
          }
          keywordOccurrences.get(text)!.add(campaign.id);
        }
      }
    }

    const totalUnique = keywordOccurrences.size;
    if (totalUnique === 0) return 0;

    let duplicatedCount = 0;
    for (const [, campaignIds] of keywordOccurrences) {
      if (campaignIds.size >= 2) {
        duplicatedCount++;
      }
    }

    return Math.min(duplicatedCount / totalUnique, 1);
  }

  // ── Chaos Score ───────────────────────────────────────────────

  /**
   * Calcule un score de chaos [0-1] basé sur 4 composantes pondérées
   */
  computeChaosScore(campaigns: CampaignWithEntities[]): number {
    if (campaigns.length === 0) return 0;

    const c1 = this.campaignCountComponent(campaigns.length);
    const c2 = this.adGroupDistributionComponent(campaigns);
    const c3 = this.budgetDistributionComponent(campaigns);
    const c4 = this.namingConsistencyComponent(campaigns.map((c) => c.name));

    const score =
      c1 * CHAOS_WEIGHTS.campaignCount +
      c2 * CHAOS_WEIGHTS.adGroupDistribution +
      c3 * CHAOS_WEIGHTS.budgetDistribution +
      c4 * CHAOS_WEIGHTS.namingConsistency;

    return Math.min(Math.max(score, 0), 1);
  }

  /**
   * Composante 1 : nombre de campagnes
   */
  private campaignCountComponent(count: number): number {
    if (count <= 1) return 0.5;
    if (count <= 3) return 0.2;
    if (count >= IDEAL_CAMPAIGN_COUNT_MIN && count <= IDEAL_CAMPAIGN_COUNT_MAX) return 0;
    if (count <= 8) return 0.15;
    if (count <= 10) return 0.3;
    return 0.6; // >10
  }

  /**
   * Composante 2 : distribution des ad groups par campagne
   * Plus la variance est élevée, plus c'est chaotique
   */
  private adGroupDistributionComponent(campaigns: CampaignWithEntities[]): number {
    const counts = campaigns.map((c) => c.adGroups.length);
    if (counts.length <= 1) return 0;

    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (mean === 0) return 0;

    const variance = counts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / counts.length;
    const cv = Math.sqrt(variance) / mean; // coefficient de variation

    return Math.min(cv, 1);
  }

  /**
   * Composante 3 : uniformité de la distribution des budgets
   */
  private budgetDistributionComponent(campaigns: CampaignWithEntities[]): number {
    const budgets = campaigns
      .map((c) => (c.dailyBudget != null ? Number(c.dailyBudget) : 0))
      .filter((b) => b > 0);

    if (budgets.length <= 1) return 0;

    const total = budgets.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;

    const proportions = budgets.map((b) => b / total);
    const uniform = 1 / proportions.length;

    // Calcul distance chi-carré simplifiée
    let chiSq = 0;
    for (const p of proportions) {
      chiSq += Math.pow(p - uniform, 2) / uniform;
    }

    // Normaliser [0-1]
    return Math.min(chiSq, 1);
  }

  /**
   * Composante 4 : cohérence des conventions de nommage
   * Détecte si les noms suivent un pattern commun
   */
  namingConsistencyComponent(names: string[]): number {
    if (names.length <= 1) return 0;

    // Extraire les patterns structurels (nombre de segments séparés par - ou _)
    const patterns = names.map((name) => {
      const segments = name.split(/[-_\s]+/).length;
      const hasNumbers = /\d/.test(name);
      const hasCaps = /[A-Z]/.test(name);
      return `${segments}-${hasNumbers ? 'N' : 'n'}-${hasCaps ? 'C' : 'c'}`;
    });

    // Trouver le pattern le plus fréquent
    const patternCounts = new Map<string, number>();
    for (const p of patterns) {
      patternCounts.set(p, (patternCounts.get(p) || 0) + 1);
    }

    let maxCount = 0;
    for (const count of patternCounts.values()) {
      if (count > maxCount) maxCount = count;
    }

    // Score = proportion de noms qui ne suivent pas le pattern dominant
    const nonMatching = names.length - maxCount;
    return nonMatching / names.length;
  }

  // ── Structural Issues Detection ───────────────────────────────

  /**
   * Détecte les problèmes structurels
   */
  detectStructuralIssues(
    campaigns: CampaignWithEntities[],
    duplicationScore: number,
    chaosScore: number,
    campaignRoles: CampaignRoleAssignment[],
    winnerKeywords: string[],
  ): StructuralIssue[] {
    const issues: StructuralIssue[] = [];

    // Duplication élevée
    if (duplicationScore > 0.3) {
      const duplicatedKws = this.findDuplicatedKeywords(campaigns);
      issues.push({
        type: 'duplication',
        severity: duplicationScore > 0.5 ? 'high' : 'medium',
        description: `Score de duplication élevé (${(duplicationScore * 100).toFixed(0)}%). ${duplicatedKws.length} mots-clés apparaissent dans plusieurs campagnes, créant de la compétition interne.`,
        affectedEntities: duplicatedKws.slice(0, 10),
      });
    }

    // Chaos élevé
    if (chaosScore > 0.5) {
      issues.push({
        type: 'chaos',
        severity: chaosScore > 0.7 ? 'high' : 'medium',
        description: `Score de chaos élevé (${(chaosScore * 100).toFixed(0)}%). La structure des campagnes manque de cohérence.`,
        affectedEntities: campaigns.map((c) => c.id),
      });
    }

    // Rôles manquants
    const allRoles = new Set<CampaignRole>();
    for (const cr of campaignRoles) {
      for (const role of cr.roles) {
        allRoles.add(role);
      }
    }
    const expectedRoles: CampaignRole[] = ['exploration', 'validation', 'amplification', 'diversification'];
    const missingRoles = expectedRoles.filter((r) => !allRoles.has(r));
    if (missingRoles.length > 0 && campaigns.length > 0) {
      issues.push({
        type: 'missing_role',
        severity: missingRoles.length >= 3 ? 'high' : missingRoles.length >= 2 ? 'medium' : 'low',
        description: `Rôles manquants dans le portefeuille : ${missingRoles.join(', ')}. Un portefeuille complet couvre exploration, validation, amplification et diversification.`,
        affectedEntities: missingRoles,
      });
    }

    // WINNERs non exploités (pas dans des campagnes exact)
    if (winnerKeywords.length > 0) {
      const winnersInExact = this.countWinnersInExactCampaigns(campaigns, winnerKeywords);
      const unexploited = winnerKeywords.length - winnersInExact;
      if (unexploited > 0) {
        issues.push({
          type: 'unexploited_winners',
          severity: unexploited >= 3 ? 'high' : 'medium',
          description: `${unexploited} mot(s)-clé(s) WINNER ne sont pas dans des campagnes exact dédiées. Leur potentiel n'est pas maximisé.`,
          affectedEntities: winnerKeywords.slice(0, 10),
        });
      }
    }

    // Budget fragmenté
    const budgets = campaigns
      .filter((c) => c.dailyBudget != null)
      .map((c) => Number(c.dailyBudget));
    if (budgets.length >= 3) {
      const minBudget = Math.min(...budgets);
      const maxBudget = Math.max(...budgets);
      if (maxBudget > 0 && minBudget / maxBudget < 0.15) {
        issues.push({
          type: 'budget_fragmentation',
          severity: 'medium',
          description: `Budget très fragmenté : la campagne la moins dotée a ${minBudget.toFixed(2)}€/j contre ${maxBudget.toFixed(2)}€/j pour la plus dotée. Les petits budgets risquent de manquer d'impressions.`,
          affectedEntities: campaigns.filter((c) => Number(c.dailyBudget) === minBudget).map((c) => c.id),
        });
      }
    }

    // Tri par sévérité
    const severityOrder = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return issues;
  }

  // ── Helpers ───────────────────────────────────────────────────

  private findDuplicatedKeywords(campaigns: CampaignWithEntities[]): string[] {
    const kwMap = new Map<string, Set<string>>();
    for (const campaign of campaigns) {
      for (const ag of campaign.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state === 'archived') continue;
          const text = kw.keywordText.toLowerCase().trim();
          if (!kwMap.has(text)) kwMap.set(text, new Set());
          kwMap.get(text)!.add(campaign.id);
        }
      }
    }
    return [...kwMap.entries()]
      .filter(([, campaigns]) => campaigns.size >= 2)
      .map(([text]) => text);
  }

  private countWinnersInExactCampaigns(
    campaigns: CampaignWithEntities[],
    winnerKeywords: string[],
  ): number {
    const winnerSet = new Set(winnerKeywords.map((k) => k.toLowerCase().trim()));
    let count = 0;
    for (const campaign of campaigns) {
      for (const ag of campaign.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.matchType === 'exact' && winnerSet.has(kw.keywordText.toLowerCase().trim())) {
            count++;
          }
        }
      }
    }
    return count;
  }
}
