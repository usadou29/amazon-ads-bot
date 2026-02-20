import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import {
  books,
  campaigns,
  campaignBookMapping,
  dailyMetrics,
  recommendations,
  marketplaceProfiles,
  adAccounts,
} from '@/db/schema';
import { eq, and, inArray, sql, gte, lte, desc } from 'drizzle-orm';
import type { Book } from '@/db/schema';

// ─── Interfaces ────────────────────────────────
export interface AuthorSummary {
  id: string;       // slug du pen name
  name: string;
  bookCount: number;
  metrics: {
    spend: number;
    sales: number;
    acos: number | null;
    roas: number | null;
    impressions: number;
    clicks: number;
    orders: number;
  };
  status: 'success' | 'warning' | 'danger' | 'no_data';
  pendingRecommendations: number;
}

export interface AuthorBookSummary {
  id: string;
  title: string;
  asin: string;
  marketplace: string;
  author: string;
  acosTarget: number | null;
  metrics: {
    spend: number;
    sales: number;
    acos: number | null;
    roas: number | null;
    impressions: number;
    clicks: number;
    orders: number;
  };
  status: 'success' | 'warning' | 'danger' | 'no_data';
  pendingRecommendations: number;
}

// ─── Helpers ───────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function computeBookStatus(
  acosTarget: number,
  acosActual: number | null,
  roas: number | null,
  impressions: number,
): 'success' | 'warning' | 'danger' | 'no_data' {
  if (impressions < 100) return 'no_data';
  if (acosActual === null || roas === null) return 'no_data';
  if (acosActual > acosTarget * 1.5 || roas < 1) return 'danger';
  if (acosActual > acosTarget * 1.2 || roas < 2) return 'warning';
  return 'success';
}

function aggregateAuthorStatus(
  bookStatuses: ('success' | 'warning' | 'danger' | 'no_data')[],
): 'success' | 'warning' | 'danger' | 'no_data' {
  if (bookStatuses.length === 0) return 'no_data';
  if (bookStatuses.includes('danger')) return 'warning';
  if (bookStatuses.includes('warning')) return 'warning';
  if (bookStatuses.every((s) => s === 'no_data')) return 'no_data';
  return 'success';
}

// ─── Service ───────────────────────────────────

@Injectable()
export class AuthorsService {
  private readonly logger = new Logger(AuthorsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
  ) {}

  /**
   * Retourne la date range 30 jours par defaut
   */
  private getDefaultDateRange(): { startDate: string; endDate: string } {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
    };
  }

  /**
   * Recupere les profile IDs pour un workspace
   */
  private async getProfileIds(workspaceId: string): Promise<string[]> {
    const profiles = await this.db
      .select({ id: marketplaceProfiles.id })
      .from(marketplaceProfiles)
      .innerJoin(adAccounts, eq(marketplaceProfiles.adAccountId, adAccounts.id))
      .where(eq(adAccounts.workspaceId, workspaceId));

    return profiles.map((p: { id: string }) => p.id);
  }

  /**
   * Recupere les metrics aggregees pour un ensemble de campagnes liees a un livre
   */
  private async getBookMetrics(
    bookId: string,
    dateRange: { startDate: string; endDate: string },
  ): Promise<{
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
  }> {
    // Trouver les campaign IDs mappees a ce livre
    const mappings = await this.db
      .select({ campaignId: campaignBookMapping.campaignId })
      .from(campaignBookMapping)
      .where(eq(campaignBookMapping.bookId, bookId));

    this.logger.log(`[getBookMetrics] bookId=${bookId} → ${mappings.length} campaign mapping(s)`);

    if (mappings.length === 0) {
      this.logger.warn(`[getBookMetrics] bookId=${bookId} has NO campaigns linked → returning zeros`);
      return { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
    }

    const campaignIds = mappings.map((m: any) => m.campaignId);
    this.logger.log(`[getBookMetrics] campaignIds (UUIDs): ${JSON.stringify(campaignIds)}`);

    // Recuperer les amazonCampaignIds pour construire les entity keys
    const campaignData = await this.db
      .select({
        id: campaigns.id,
        amazonCampaignId: campaigns.amazonCampaignId,
        name: campaigns.name,
      })
      .from(campaigns)
      .where(inArray(campaigns.id, campaignIds));

    this.logger.log(`[getBookMetrics] Found ${campaignData.length} campaign(s) in campaigns table: ${JSON.stringify(campaignData.map((c: any) => ({ id: c.id, amazonId: c.amazonCampaignId, name: c.name })))}`);

    if (campaignData.length === 0) {
      this.logger.warn(`[getBookMetrics] No campaign rows found for UUIDs → returning zeros`);
      return { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
    }

    // Construire les entity keys pour les campagnes
    const entityKeys = campaignData.map(
      (c: any) => `campaign:${c.amazonCampaignId}`,
    );
    this.logger.log(`[getBookMetrics] entityKeys built: ${JSON.stringify(entityKeys)}`);
    this.logger.log(`[getBookMetrics] dateRange: ${dateRange.startDate} → ${dateRange.endDate}`);

    // Verification: chercher TOUTES les entity keys dans daily_metrics (sans filtre date)
    const checkExist = await this.db
      .select({
        entityKey: dailyMetrics.entityKey,
        count: sql<number>`COUNT(*)`,
        minDate: sql<string>`MIN(${dailyMetrics.date})`,
        maxDate: sql<string>`MAX(${dailyMetrics.date})`,
      })
      .from(dailyMetrics)
      .where(
        and(
          eq(dailyMetrics.entityType, 'campaign'),
          inArray(dailyMetrics.entityKey, entityKeys),
        ),
      )
      .groupBy(dailyMetrics.entityKey);

    this.logger.log(`[getBookMetrics] daily_metrics rows found (no date filter): ${JSON.stringify(checkExist)}`);

    if (checkExist.length === 0) {
      // Check what entityKeys actually exist in daily_metrics for campaigns
      const sampleKeys = await this.db
        .select({
          entityKey: dailyMetrics.entityKey,
        })
        .from(dailyMetrics)
        .where(eq(dailyMetrics.entityType, 'campaign'))
        .limit(5);
      this.logger.warn(`[getBookMetrics] NO matching daily_metrics found! Sample entityKeys in DB: ${JSON.stringify(sampleKeys)}`);
    }

    // Agreger les daily_metrics pour ces entity keys
    const [result] = await this.db
      .select({
        impressions: sql<number>`COALESCE(SUM(${dailyMetrics.impressions}), 0)`,
        clicks: sql<number>`COALESCE(SUM(${dailyMetrics.clicks}), 0)`,
        spend: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.spend} AS DECIMAL)), 0)`,
        sales: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.sales} AS DECIMAL)), 0)`,
        orders: sql<number>`COALESCE(SUM(${dailyMetrics.orders}), 0)`,
      })
      .from(dailyMetrics)
      .where(
        and(
          eq(dailyMetrics.entityType, 'campaign'),
          inArray(dailyMetrics.entityKey, entityKeys),
          gte(dailyMetrics.date, dateRange.startDate),
          lte(dailyMetrics.date, dateRange.endDate),
        ),
      );

    this.logger.log(`[getBookMetrics] Final aggregation result: ${JSON.stringify(result)}`);

    return {
      impressions: Number(result?.impressions || 0),
      clicks: Number(result?.clicks || 0),
      spend: Number(result?.spend || 0),
      sales: Number(result?.sales || 0),
      orders: Number(result?.orders || 0),
    };
  }

  /**
   * Compte les recommandations pending pour un ensemble de campagnes liees a un livre
   */
  private async getPendingRecoCount(bookId: string, workspaceId: string): Promise<number> {
    const mappings = await this.db
      .select({ campaignId: campaignBookMapping.campaignId })
      .from(campaignBookMapping)
      .where(eq(campaignBookMapping.bookId, bookId));

    if (mappings.length === 0) return 0;

    const campaignIds = mappings.map((m: any) => m.campaignId);

    const campaignData = await this.db
      .select({ amazonCampaignId: campaigns.amazonCampaignId })
      .from(campaigns)
      .where(inArray(campaigns.id, campaignIds));

    if (campaignData.length === 0) return 0;

    // On cherche les recos pending dont l'entityKey commence par les campaign IDs
    // ou qui sont directement liees au workspace
    const entityKeys = campaignData.map(
      (c: any) => `campaign:${c.amazonCampaignId}`,
    );

    const [result] = await this.db
      .select({
        count: sql<number>`COUNT(*)`,
      })
      .from(recommendations)
      .where(
        and(
          eq(recommendations.workspaceId, workspaceId),
          eq(recommendations.status, 'pending'),
        ),
      );

    // Note: les recos ne sont pas directement liees aux livres.
    // On retourne le count global pour le workspace, divise par le nombre de livres.
    // Une meilleure approche serait de lier les recos aux campagnes.
    return Number(result?.count || 0);
  }

  /**
   * GET /api/authors?workspaceId=X
   * Liste les auteurs avec KPIs agreges
   */
  async findAll(workspaceId: string): Promise<AuthorSummary[]> {
    const dateRange = this.getDefaultDateRange();

    // Recuperer tous les livres du workspace, groupes par auteur
    const allBooks = await this.db
      .select()
      .from(books)
      .where(eq(books.workspaceId, workspaceId))
      .orderBy(books.author);

    if (allBooks.length === 0) {
      return [];
    }

    // Grouper par auteur
    const authorMap = new Map<string, Book[]>();
    for (const book of allBooks) {
      const authorName = book.author || 'Auteur inconnu';
      if (!authorMap.has(authorName)) {
        authorMap.set(authorName, []);
      }
      authorMap.get(authorName)!.push(book);
    }

    // Count total pending recos pour le workspace
    const [recoCount] = await this.db
      .select({
        count: sql<number>`COUNT(*)`,
      })
      .from(recommendations)
      .where(
        and(
          eq(recommendations.workspaceId, workspaceId),
          eq(recommendations.status, 'pending'),
        ),
      );
    const totalPendingRecos = Number(recoCount?.count || 0);

    // Pour chaque auteur, agreger les metriques de tous ses livres
    const authors: AuthorSummary[] = [];

    for (const [authorName, authorBooks] of authorMap) {
      let totalSpend = 0;
      let totalSales = 0;
      let totalImpressions = 0;
      let totalClicks = 0;
      let totalOrders = 0;
      const bookStatuses: ('success' | 'warning' | 'danger' | 'no_data')[] = [];

      for (const book of authorBooks) {
        const metrics = await this.getBookMetrics(book.id, dateRange);
        totalSpend += metrics.spend;
        totalSales += metrics.sales;
        totalImpressions += metrics.impressions;
        totalClicks += metrics.clicks;
        totalOrders += metrics.orders;

        const acosTarget = book.acosTarget ? Number(book.acosTarget) : 40;
        const acos = metrics.sales > 0 ? (metrics.spend / metrics.sales) * 100 : null;
        const roas = metrics.spend > 0 ? metrics.sales / metrics.spend : null;
        bookStatuses.push(computeBookStatus(acosTarget, acos, roas, metrics.impressions));
      }

      const acos = totalSales > 0 ? (totalSpend / totalSales) * 100 : null;
      const roas = totalSpend > 0 ? totalSales / totalSpend : null;
      const status = aggregateAuthorStatus(bookStatuses);

      // Repartir les pending recos proportionnellement (approximation)
      const pendingRecos = Math.round(
        (totalPendingRecos * authorBooks.length) / allBooks.length,
      );

      authors.push({
        id: slugify(authorName),
        name: authorName,
        bookCount: authorBooks.length,
        metrics: {
          spend: Math.round(totalSpend * 100) / 100,
          sales: Math.round(totalSales * 100) / 100,
          acos: acos !== null ? Math.round(acos * 10) / 10 : null,
          roas: roas !== null ? Math.round(roas * 100) / 100 : null,
          impressions: totalImpressions,
          clicks: totalClicks,
          orders: totalOrders,
        },
        status,
        pendingRecommendations: pendingRecos,
      });
    }

    return authors;
  }

  /**
   * GET /api/authors/:authorId/books?workspaceId=X
   * Liste les livres d'un auteur avec KPIs individuels
   */
  async findBooksByAuthor(authorSlug: string, workspaceId: string): Promise<AuthorBookSummary[]> {
    const dateRange = this.getDefaultDateRange();

    // Recuperer tous les livres du workspace
    const allBooks = await this.db
      .select()
      .from(books)
      .where(eq(books.workspaceId, workspaceId));

    // Filtrer par auteur (slug match)
    const authorBooks = allBooks.filter((b: Book) => {
      const name = b.author || 'Auteur inconnu';
      return slugify(name) === authorSlug;
    });

    if (authorBooks.length === 0) {
      throw new NotFoundException(`Author "${authorSlug}" not found in workspace`);
    }

    // Count pending recos pour le workspace
    const [recoCount] = await this.db
      .select({
        count: sql<number>`COUNT(*)`,
      })
      .from(recommendations)
      .where(
        and(
          eq(recommendations.workspaceId, workspaceId),
          eq(recommendations.status, 'pending'),
        ),
      );
    const totalPendingRecos = Number(recoCount?.count || 0);

    const result: AuthorBookSummary[] = [];

    for (const book of authorBooks) {
      const metrics = await this.getBookMetrics(book.id, dateRange);
      const acosTarget = book.acosTarget ? Number(book.acosTarget) : 40;
      const acos = metrics.sales > 0 ? (metrics.spend / metrics.sales) * 100 : null;
      const roas = metrics.spend > 0 ? metrics.sales / metrics.spend : null;
      const status = computeBookStatus(acosTarget, acos, roas, metrics.impressions);

      // Repartir les recos (approximation)
      const pendingRecos = Math.round(totalPendingRecos / allBooks.length);

      result.push({
        id: book.id,
        title: book.title || book.asin,
        asin: book.asin,
        marketplace: book.marketplace,
        author: book.author || 'Auteur inconnu',
        acosTarget,
        metrics: {
          spend: Math.round(metrics.spend * 100) / 100,
          sales: Math.round(metrics.sales * 100) / 100,
          acos: acos !== null ? Math.round(acos * 10) / 10 : null,
          roas: roas !== null ? Math.round(roas * 100) / 100 : null,
          impressions: metrics.impressions,
          clicks: metrics.clicks,
          orders: metrics.orders,
        },
        status,
        pendingRecommendations: pendingRecos,
      });
    }

    return result;
  }
}
