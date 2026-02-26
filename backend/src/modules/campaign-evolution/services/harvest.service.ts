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
import { HARVEST_MIN_KEYWORDS, HARVEST_WINDOWS, LIFECYCLE_STRATEGIC_DAYS } from '../constants';

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

    return {
      winnerKeywords,
      winnerSearchTerms: [], // filled async via harvestAsync
      winnerAsins,
      suggestedNegatives,
      windowDays: baseDays,
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

    this.logger.debug(
      `Harvested for book ${ctx.bookContext.id}: ${winnerKeywords.length} keywords, ` +
      `${winnerSearchTerms.length} search terms, ${winnerAsins.length} ASINs, ` +
      `${suggestedNegatives.length} negatives (window=${effectiveDays}d)`,
    );

    return {
      winnerKeywords,
      winnerSearchTerms,
      winnerAsins,
      suggestedNegatives,
      windowDays: effectiveDays,
    };
  }

  // ── Winner Keywords ────────────────────────────────────────

  private extractWinnerKeywords(ctx: TopFocusContext): WinnerKeywordAsset[] {
    const winners: WinnerKeywordAsset[] = [];
    const seen = new Set<string>();

    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      const insights = ctx.entityInsightsMap.get(c.id) || [];

      for (const ag of c.adGroups) {
        for (const kw of ag.keywords) {
          if (kw.state === 'archived') continue;
          const key = `keyword:${kw.id}`;
          const insight = insights.find(
            (i: EntityInsight) => i.entityKey === key && i.diagnosisCode === 'winner',
          );

          if (insight && !seen.has(kw.keywordText.toLowerCase())) {
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

  private extractWinnerAsins(ctx: TopFocusContext): string[] {
    const asins = new Set<string>();

    for (const c of ctx.campaigns) {
      if (c.state === 'archived') continue;
      const insights = ctx.entityInsightsMap.get(c.id) || [];

      for (const ag of c.adGroups) {
        for (const tg of ag.targets) {
          if (tg.state === 'archived') continue;
          if (tg.expressionType !== 'asinSameAs') continue;

          const key = `target:${tg.id}`;
          const insight = insights.find(
            (i: EntityInsight) => i.entityKey === key && i.diagnosisCode === 'winner',
          );

          if (insight) {
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
            (i: EntityInsight) => i.entityKey === key && (
              i.diagnosisCode === 'very_expensive' as any ||
              i.diagnosisCode === 'clicks_no_sales' as any
            ),
          );

          if (insight && !negatives.has(kw.keywordText.toLowerCase())) {
            negatives.add(kw.keywordText.toLowerCase());
          }
        }
      }
    }

    return [...negatives];
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
