import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { searchTerms } from '@/db/schema/search-terms';
import { and, inArray, gte, sql } from 'drizzle-orm';
import {
  type TopFocusContext,
  type HarvestedAssets,
  type WinnerKeywordAsset,
  type SearchTermAsset,
  type EntityInsight,
} from '../campaign-evolution.types';
import { HARVEST_MIN_KEYWORDS, HARVEST_WINDOWS, LIFECYCLE_STRATEGIC_DAYS, LIFECYCLE_DEFAULT_BIDS } from '../constants';

@Injectable()
export class HarvestService {
  private readonly logger = new Logger(HarvestService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Harvest reusable assets (winners, search terms, ASINs, negatives)
   * from existing campaign data. Uses multi-window fallback.
   */
  harvest(ctx: TopFocusContext, targetDays?: number): HarvestedAssets {
    const lifecycle = ctx.bookContext.lifecyclePhase || 'launch';
    const baseDays = targetDays || LIFECYCLE_STRATEGIC_DAYS[lifecycle] || 14;

    // Extract winners from entity insights (already computed in analyze pipeline)
    const winnerKeywords = this.extractWinnerKeywords(ctx);
    const winnerAsins = this.extractWinnerAsins(ctx);
    const suggestedNegatives = this.extractSuggestedNegatives(ctx);

    // Compute bid & placement metrics from real data
    const avgWinningBid = this.computeAvgWinningBid(ctx);
    const avgCpcObserved = this.computeAvgCpcObserved(ctx);
    const topPlacementPerformance = this.computeTopPlacementPerformance(ctx);
    const userProvidedKeywords = this.inferUserProvidedKeywords(ctx);

    return {
      winnerKeywords,
      winnerSearchTerms: [], // filled async via harvestAsync
      winnerAsins,
      suggestedNegatives,
      windowDays: baseDays,
      avgWinningBid,
      avgCpcObserved,
      topPlacementPerformance,
      userProvidedKeywords,
    };
  }

  /**
   * Async harvest that also queries search terms from DB.
   * Call this when you need the full harvest including search terms.
   */
  async harvestAsync(ctx: TopFocusContext, targetDays?: number): Promise<HarvestedAssets> {
    const lifecycle = ctx.bookContext.lifecyclePhase || 'launch';
    const baseDays = targetDays || LIFECYCLE_STRATEGIC_DAYS[lifecycle] || 14;

    // Sync extractions
    let winnerKeywords = this.extractWinnerKeywords(ctx);
    const winnerAsins = this.extractWinnerAsins(ctx);
    const suggestedNegatives = this.extractSuggestedNegatives(ctx);

    // Async: search terms from DB with multi-window fallback
    const campaignIds = ctx.campaigns
      .filter(c => c.state !== 'archived')
      .map(c => c.id);

    let winnerSearchTerms: SearchTermAsset[] = [];
    let effectiveDays = baseDays;

    if (campaignIds.length > 0) {
      // Multi-window fallback for search terms
      for (const window of HARVEST_WINDOWS) {
        if (window < baseDays) continue; // skip windows smaller than base
        winnerSearchTerms = await this.queryWinnerSearchTerms(campaignIds, window);
        effectiveDays = window;
        if (winnerKeywords.length + winnerSearchTerms.length >= HARVEST_MIN_KEYWORDS) break;
      }

      // If still not enough, try all windows from start
      if (winnerKeywords.length + winnerSearchTerms.length < HARVEST_MIN_KEYWORDS) {
        for (const window of HARVEST_WINDOWS) {
          if (window >= baseDays) continue; // already tried these
          winnerSearchTerms = await this.queryWinnerSearchTerms(campaignIds, window);
          effectiveDays = window;
          if (winnerKeywords.length + winnerSearchTerms.length >= HARVEST_MIN_KEYWORDS) break;
        }
      }
    }

    // Compute bid & placement metrics from real data
    const avgWinningBid = this.computeAvgWinningBid(ctx);
    const avgCpcObserved = this.computeAvgCpcObserved(ctx);
    const topPlacementPerformance = this.computeTopPlacementPerformance(ctx);
    const userProvidedKeywords = this.inferUserProvidedKeywords(ctx);

    this.logger.debug(
      `Harvested for book ${ctx.bookContext.id}: ${winnerKeywords.length} keywords, ` +
      `${winnerSearchTerms.length} search terms, ${winnerAsins.length} ASINs, ` +
      `${suggestedNegatives.length} negatives (window=${effectiveDays}d), ` +
      `avgWinningBid=${avgWinningBid}, avgCpc=${avgCpcObserved}, topPlacement=${topPlacementPerformance}`,
    );

    return {
      winnerKeywords,
      winnerSearchTerms,
      winnerAsins,
      suggestedNegatives,
      windowDays: effectiveDays,
      avgWinningBid,
      avgCpcObserved,
      topPlacementPerformance,
      userProvidedKeywords,
    };
  }

  // ── Winner Keywords ────────────────────────────────────────

  /**
   * Extract winner keywords with TOLERANT criteria:
   *   - orders >= 1  OR
   *   - ACOS <= targetAcos × 1.2
   * This casts a wider net than the strict "winner" diagnosis code.
   */
  private extractWinnerKeywords(ctx: TopFocusContext): WinnerKeywordAsset[] {
    const winners: WinnerKeywordAsset[] = [];
    const seen = new Set<string>();
    const targetAcos = ctx.bookContext.acosTarget || 30;
    const acosThreshold = targetAcos * 1.2;

    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      const insights = ctx.entityInsightsMap.get(c.id) || [];

      for (const ag of c.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state === 'archived') continue;
          const key = `keyword:${kw.id}`;
          const insight = insights.find(
            (i: EntityInsight) => i.entityKey === key,
          );
          if (!insight) continue;

          const { orders, acos } = insight.summaryFacts;
          const isWinner = orders >= 1 || (acos !== null && acos !== undefined && acos > 0 && acos <= acosThreshold);

          if (isWinner && !seen.has(kw.keywordText.toLowerCase())) {
            seen.add(kw.keywordText.toLowerCase());
            winners.push({
              text: kw.keywordText,
              matchType: kw.matchType,
              acos: insight.summaryFacts.acos ?? undefined,
              orders: insight.summaryFacts.orders,
              campaignId: c.id,
            });
          }
        }
      }
    }

    // Sort by orders desc (best performers first)
    winners.sort((a, b) => (b.orders || 0) - (a.orders || 0));

    return winners;
  }

  // ── Winner ASINs ───────────────────────────────────────────

  /**
   * Extract winner ASINs with TOLERANT criteria:
   *   - orders >= 1  OR
   *   - CTR >= average CTR across all targets in that campaign
   */
  private extractWinnerAsins(ctx: TopFocusContext): string[] {
    const asins = new Set<string>();

    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      const insights = ctx.entityInsightsMap.get(c.id) || [];

      // Compute avg CTR for this campaign's targets
      let totalCtr = 0;
      let targetCount = 0;
      for (const insight of insights) {
        if (!insight.entityKey.startsWith('target:')) continue;
        const { impressions, clicks } = insight.summaryFacts;
        if (impressions > 0) {
          totalCtr += clicks / impressions;
          targetCount++;
        }
      }
      const avgCtr = targetCount > 0 ? totalCtr / targetCount : 0;

      for (const ag of c.adGroups) {
        for (const tg of ag.targets) {
          if (tg.state === 'archived') continue;
          if (tg.expressionType !== 'asinSameAs') continue;

          const key = `target:${tg.id}`;
          const insight = insights.find(
            (i: EntityInsight) => i.entityKey === key,
          );
          if (!insight) continue;

          const { orders, impressions, clicks } = insight.summaryFacts;
          const ctr = impressions > 0 ? clicks / impressions : 0;
          const isWinner = orders >= 1 || (avgCtr > 0 && ctr >= avgCtr);

          if (isWinner) {
            const asin = typeof tg.expression === 'string'
              ? tg.expression
              : tg.expression?.value;
            if (asin) asins.add(asin);
          }
        }
      }
    }

    return [...asins];
  }

  // ── Suggested Negatives ────────────────────────────────────

  /**
   * Extract suggested negatives with strict criteria:
   *   - clicks >= 15  AND
   *   - orders = 0
   * These are keywords that consume budget without converting.
   */
  private extractSuggestedNegatives(ctx: TopFocusContext): string[] {
    const negatives = new Set<string>();

    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      const insights = ctx.entityInsightsMap.get(c.id) || [];

      for (const ag of c.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state === 'archived') continue;
          const key = `keyword:${kw.id}`;
          const insight = insights.find(
            (i: EntityInsight) => i.entityKey === key,
          );
          if (!insight) continue;

          const { clicks, orders } = insight.summaryFacts;
          if (clicks >= 15 && orders === 0 && !negatives.has(kw.keywordText.toLowerCase())) {
            negatives.add(kw.keywordText.toLowerCase());
          }
        }
      }
    }

    return [...negatives];
  }

  // ── Average Winning Bid (CPC of winner keywords) ──────────

  /**
   * Compute avg CPC of WINNER keywords: spend / clicks for each winner entity.
   * Returns null if no winners with spend data.
   */
  private computeAvgWinningBid(ctx: TopFocusContext): number | null {
    const cpcs: number[] = [];

    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      const insights = ctx.entityInsightsMap.get(c.id) || [];

      for (const insight of insights) {
        if (insight.diagnosisCode !== 'winner') continue;
        if (!insight.entityKey.startsWith('keyword:')) continue;

        const { spend, clicks } = insight.summaryFacts;
        if (clicks > 0 && spend > 0) {
          cpcs.push(spend / clicks);
        }
      }
    }

    if (cpcs.length === 0) return null;
    const avg = cpcs.reduce((sum, v) => sum + v, 0) / cpcs.length;
    return Math.round(avg * 100) / 100; // round to 2 decimals
  }

  // ── Average CPC Observed (all keywords with spend) ────────

  /**
   * Compute avg CPC across ALL keyword entities that have spend > 0.
   * Gives a market baseline for fallback bidding.
   */
  private computeAvgCpcObserved(ctx: TopFocusContext): number | null {
    const cpcs: number[] = [];

    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      const insights = ctx.entityInsightsMap.get(c.id) || [];

      for (const insight of insights) {
        if (!insight.entityKey.startsWith('keyword:')) continue;

        const { spend, clicks } = insight.summaryFacts;
        if (clicks > 0 && spend > 0) {
          cpcs.push(spend / clicks);
        }
      }
    }

    if (cpcs.length === 0) return null;
    const avg = cpcs.reduce((sum, v) => sum + v, 0) / cpcs.length;
    return Math.round(avg * 100) / 100;
  }

  // ── Top Placement Performance (CVR ratio) ─────────────────

  /**
   * Compute top-of-search CVR vs rest-of-search CVR ratio.
   * Uses campaign-level insight data. >1 means top performs better.
   * Returns null if insufficient data.
   */
  private computeTopPlacementPerformance(ctx: TopFocusContext): number | null {
    // We approximate from entity-level data: winners tend to have higher CVR
    // which correlates with top-of-search placement. For a proper calculation
    // we'd need placement reports, but we use the CVR gap as a proxy.
    let totalWinnerCvr = 0;
    let winnerCount = 0;
    let totalOtherCvr = 0;
    let otherCount = 0;

    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      const insights = ctx.entityInsightsMap.get(c.id) || [];

      for (const insight of insights) {
        if (!insight.entityKey.startsWith('keyword:')) continue;
        const { clicks, orders } = insight.summaryFacts;
        if (clicks < 10) continue; // need min data for CVR

        const cvr = orders / clicks;
        if (insight.diagnosisCode === 'winner' || insight.diagnosisCode === 'boost_candidate') {
          totalWinnerCvr += cvr;
          winnerCount++;
        } else if (clicks >= 15) {
          totalOtherCvr += cvr;
          otherCount++;
        }
      }
    }

    if (winnerCount === 0 || otherCount === 0) return null;

    const avgWinnerCvr = totalWinnerCvr / winnerCount;
    const avgOtherCvr = totalOtherCvr / otherCount;
    if (avgOtherCvr === 0) return null;

    const ratio = avgWinnerCvr / avgOtherCvr;
    return Math.round(ratio * 100) / 100;
  }

  // ── User Provided Keywords (inferred from book title) ─────

  /**
   * Infer seed keywords from book title. These are used when no
   * historical winner data exists.
   */
  private inferUserProvidedKeywords(ctx: TopFocusContext): string[] {
    const title = ctx.bookContext.title || '';
    const words = title
      .toLowerCase()
      .replace(/[^a-zàâéèêëïîôùûüç0-9\s-]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);
    return words.length > 0 ? words.slice(0, 8) : [];
  }

  // ── Search Terms from DB ───────────────────────────────────

  private async queryWinnerSearchTerms(
    campaignIds: string[],
    windowDays: number,
  ): Promise<SearchTermAsset[]> {
    if (campaignIds.length === 0) return [];

    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - windowDays);

      const rows = await this.db
        .select({
          query: searchTerms.query,
          count: sql<number>`count(*)::int`,
        })
        .from(searchTerms)
        .where(
          and(
            inArray(searchTerms.campaignId, campaignIds),
            gte(searchTerms.lastSeenAt, cutoff),
            // Only promoted or reviewed (validated by user or system)
            inArray(searchTerms.status, ['promoted', 'reviewed']),
          ),
        )
        .groupBy(searchTerms.query)
        .orderBy(sql`count(*) DESC`)
        .limit(20);

      return rows.map((r: any) => ({
        query: r.query,
        count: Number(r.count),
      }));
    } catch (err) {
      this.logger.warn(`Failed to query search terms: ${err}`);
      return [];
    }
  }
}
