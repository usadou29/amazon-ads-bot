import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import {
  books,
  campaigns,
  campaignBookMapping,
  dailyMetrics,
  recommendations,
  actionLog,
  marketplaceProfiles,
  adAccounts,
  adGroups,
  keywords,
} from '@/db/schema';
import { eq, and, inArray, sql, gte, lte, desc } from 'drizzle-orm';
import type { Book, NewBook, CampaignBookMapping } from '@/db/schema';
import type { LifecyclePhase } from '@/db/schema/books';

export interface CreateBookDto {
  workspaceId: string;
  asin: string;
  marketplace: string;
  title?: string;
  author?: string;
  kdpId?: string;
  publicationDate?: string;
  categories?: string[];
  tags?: string[];
  acosTarget?: number;
  dailyBudgetTarget?: number;
  royaltyRate?: number;
  salePrice?: number;
  royaltyPerUnit?: number;
}

export interface UpdateBookDto {
  title?: string;
  author?: string;
  kdpId?: string;
  publicationDate?: string;
  categories?: string[];
  tags?: string[];
  acosTarget?: number;
  dailyBudgetTarget?: number;
  royaltyRate?: number;
  salePrice?: number;
  royaltyPerUnit?: number;
  lifecyclePhaseOverride?: string | null;
}

export interface BookWithCampaigns extends Book {
  campaigns: {
    id: string;
    name: string;
    campaignType: string;
    state: string;
    isPrimary: boolean;
  }[];
}

export interface MapCampaignDto {
  bookId: string;
  campaignId: string;
  isPrimary?: boolean;
  notes?: string;
}

@Injectable()
export class BooksService {
  private readonly logger = new Logger(BooksService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
  ) {}

  /**
   * Recupere tous les livres d'un workspace
   */
  async findAll(workspaceId: string): Promise<BookWithCampaigns[]> {
    const booksList = await this.db
      .select()
      .from(books)
      .where(eq(books.workspaceId, workspaceId))
      .orderBy(books.createdAt);

    // Recuperer les mappings pour tous les livres
    const bookIds = booksList.map((b: Book) => b.id);

    if (bookIds.length === 0) {
      return [];
    }

    const mappings = await this.db
      .select({
        bookId: campaignBookMapping.bookId,
        campaignId: campaignBookMapping.campaignId,
        isPrimary: campaignBookMapping.isPrimary,
        campaign: {
          id: campaigns.id,
          name: campaigns.name,
          campaignType: campaigns.campaignType,
          state: campaigns.state,
        },
      })
      .from(campaignBookMapping)
      .innerJoin(campaigns, eq(campaignBookMapping.campaignId, campaigns.id))
      .where(inArray(campaignBookMapping.bookId, bookIds));

    // Grouper les campaigns par livre
    const campaignsByBook = new Map<string, BookWithCampaigns['campaigns']>();
    for (const mapping of mappings) {
      if (!campaignsByBook.has(mapping.bookId)) {
        campaignsByBook.set(mapping.bookId, []);
      }
      campaignsByBook.get(mapping.bookId)!.push({
        id: mapping.campaign.id,
        name: mapping.campaign.name,
        campaignType: mapping.campaign.campaignType,
        state: mapping.campaign.state,
        isPrimary: mapping.isPrimary ?? false,
      });
    }

    return booksList.map((book: Book) => ({
      ...book,
      campaigns: campaignsByBook.get(book.id) || [],
    }));
  }

  /**
   * Recupere un livre par ID
   */
  async findOne(id: string): Promise<BookWithCampaigns> {
    const [book] = await this.db
      .select()
      .from(books)
      .where(eq(books.id, id))
      .limit(1);

    if (!book) {
      throw new NotFoundException(`Book ${id} not found`);
    }

    const mappings = await this.db
      .select({
        campaignId: campaignBookMapping.campaignId,
        isPrimary: campaignBookMapping.isPrimary,
        campaign: {
          id: campaigns.id,
          name: campaigns.name,
          campaignType: campaigns.campaignType,
          state: campaigns.state,
        },
      })
      .from(campaignBookMapping)
      .innerJoin(campaigns, eq(campaignBookMapping.campaignId, campaigns.id))
      .where(eq(campaignBookMapping.bookId, id));

    return {
      ...book,
      campaigns: mappings.map((m: any) => ({
        id: m.campaign.id,
        name: m.campaign.name,
        campaignType: m.campaign.campaignType,
        state: m.campaign.state,
        isPrimary: m.isPrimary ?? false,
      })),
    };
  }

  /**
   * Cree un nouveau livre
   */
  async create(dto: CreateBookDto): Promise<Book> {
    // Verifier si le livre existe deja pour ce workspace/ASIN/marketplace
    const [existing] = await this.db
      .select()
      .from(books)
      .where(
        and(
          eq(books.workspaceId, dto.workspaceId),
          eq(books.asin, dto.asin),
          eq(books.marketplace, dto.marketplace),
        ),
      )
      .limit(1);

    if (existing) {
      throw new BadRequestException(
        `Book with ASIN ${dto.asin} already exists for marketplace ${dto.marketplace}`,
      );
    }

    const [book] = await this.db
      .insert(books)
      .values({
        workspaceId: dto.workspaceId,
        asin: dto.asin,
        marketplace: dto.marketplace,
        title: dto.title,
        author: dto.author,
        kdpId: dto.kdpId,
        publicationDate: dto.publicationDate,
        categories: dto.categories || [],
        tags: dto.tags || [],
        acosTarget: dto.acosTarget?.toString(),
        dailyBudgetTarget: dto.dailyBudgetTarget?.toString(),
        royaltyRate: dto.royaltyRate?.toString(),
        salePrice: dto.salePrice?.toString(),
        royaltyPerUnit: dto.royaltyPerUnit?.toString(),
      })
      .returning();

    this.logger.log(`Created book ${book.id} (ASIN: ${dto.asin}) for workspace ${dto.workspaceId}`);

    return book;
  }

  /**
   * Met a jour un livre
   */
  async update(id: string, dto: UpdateBookDto): Promise<Book> {
    const [existing] = await this.db
      .select()
      .from(books)
      .where(eq(books.id, id))
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Book ${id} not found`);
    }

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.author !== undefined) updateData.author = dto.author;
    if (dto.kdpId !== undefined) updateData.kdpId = dto.kdpId;
    if (dto.publicationDate !== undefined) updateData.publicationDate = dto.publicationDate;
    if (dto.categories !== undefined) updateData.categories = dto.categories;
    if (dto.tags !== undefined) updateData.tags = dto.tags;
    if (dto.acosTarget !== undefined) updateData.acosTarget = dto.acosTarget.toString();
    if (dto.dailyBudgetTarget !== undefined) updateData.dailyBudgetTarget = dto.dailyBudgetTarget.toString();
    if (dto.royaltyRate !== undefined) updateData.royaltyRate = dto.royaltyRate.toString();
    if (dto.salePrice !== undefined) updateData.salePrice = dto.salePrice.toString();
    if (dto.royaltyPerUnit !== undefined) updateData.royaltyPerUnit = dto.royaltyPerUnit.toString();
    if (dto.lifecyclePhaseOverride !== undefined) updateData.lifecyclePhaseOverride = dto.lifecyclePhaseOverride;

    const [updated] = await this.db
      .update(books)
      .set(updateData)
      .where(eq(books.id, id))
      .returning();

    this.logger.log(`Updated book ${id}`);

    return updated;
  }

  /**
   * Supprime un livre
   */
  async delete(id: string): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(books)
      .where(eq(books.id, id))
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Book ${id} not found`);
    }

    await this.db.delete(books).where(eq(books.id, id));

    this.logger.log(`Deleted book ${id}`);
  }

  /**
   * Associe une campagne a un livre
   */
  async mapCampaign(dto: MapCampaignDto): Promise<CampaignBookMapping> {
    // Verifier que le livre existe
    const [book] = await this.db
      .select()
      .from(books)
      .where(eq(books.id, dto.bookId))
      .limit(1);

    if (!book) {
      throw new NotFoundException(`Book ${dto.bookId} not found`);
    }

    // Verifier que la campagne existe
    const [campaign] = await this.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, dto.campaignId))
      .limit(1);

    if (!campaign) {
      throw new NotFoundException(`Campaign ${dto.campaignId} not found`);
    }

    // Si isPrimary est true, retirer le flag des autres mappings
    if (dto.isPrimary) {
      await this.db
        .update(campaignBookMapping)
        .set({ isPrimary: false })
        .where(eq(campaignBookMapping.bookId, dto.bookId));
    }

    // Creer ou mettre a jour le mapping
    const [mapping] = await this.db
      .insert(campaignBookMapping)
      .values({
        bookId: dto.bookId,
        campaignId: dto.campaignId,
        isPrimary: dto.isPrimary ?? false,
        notes: dto.notes,
      })
      .onConflictDoUpdate({
        target: [campaignBookMapping.bookId, campaignBookMapping.campaignId],
        set: {
          isPrimary: dto.isPrimary ?? false,
          notes: dto.notes,
        },
      })
      .returning();

    this.logger.log(`Mapped campaign ${dto.campaignId} to book ${dto.bookId}`);

    return mapping;
  }

  /**
   * Retire l'association d'une campagne a un livre
   */
  async unmapCampaign(bookId: string, campaignId: string): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(campaignBookMapping)
      .where(
        and(
          eq(campaignBookMapping.bookId, bookId),
          eq(campaignBookMapping.campaignId, campaignId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundException(`Mapping not found for book ${bookId} and campaign ${campaignId}`);
    }

    await this.db
      .delete(campaignBookMapping)
      .where(
        and(
          eq(campaignBookMapping.bookId, bookId),
          eq(campaignBookMapping.campaignId, campaignId),
        ),
      );

    this.logger.log(`Unmapped campaign ${campaignId} from book ${bookId}`);
  }

  /**
   * Recupere les campagnes disponibles pour un workspace (non encore mappees a un livre)
   */
  async getAvailableCampaigns(workspaceId: string, bookId?: string): Promise<any[]> {
    // Cette requete est complexe car on doit traverser workspace -> ad_accounts -> marketplace_profiles -> campaigns
    // On utilise une sous-requete pour trouver les campaigns deja mappees
    const query = sql`
      SELECT
        c.id,
        c.name,
        c.campaign_type,
        c.state,
        c.daily_budget,
        mp.marketplace
      FROM campaigns c
      INNER JOIN marketplace_profiles mp ON c.profile_id = mp.id
      INNER JOIN ad_accounts aa ON mp.ad_account_id = aa.id
      WHERE aa.workspace_id = ${workspaceId}
        AND c.id NOT IN (
          SELECT campaign_id FROM campaign_book_mapping
          ${bookId ? sql`WHERE book_id != ${bookId}` : sql``}
        )
      ORDER BY c.name
    `;

    const result = await this.db.execute(query);
    return result.rows || result;
  }

  // ─── Lifecycle Phase Detection ─────────────────────

  /**
   * Calcule le nombre de jours depuis la date de publication.
   * Retourne Infinity si la date est null.
   */
  private daysSincePublication(publicationDate: string | null): number {
    if (!publicationDate) return Infinity;
    const pubDate = new Date(publicationDate);
    if (isNaN(pubDate.getTime())) return Infinity;
    return Math.floor((Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24));
  }

  /**
   * Auto-détecte la phase de cycle de vie d'un livre basé sur sa date de publication.
   * La phase "relaunch" est uniquement manuelle (l'auteur la déclenche).
   */
  private detectLifecyclePhase(publicationDate: string | null): LifecyclePhase {
    const days = this.daysSincePublication(publicationDate);

    if (days <= 30) return 'launch';
    if (days <= 180) return 'scale';
    return 'evergreen';
  }

  /**
   * Retourne la phase effective d'un livre :
   * - Si override existe → utiliser l'override
   * - Sinon → auto-détection basée sur publicationDate
   */
  getEffectiveLifecyclePhase(book: Book): LifecyclePhase {
    if (book.lifecyclePhaseOverride) {
      return book.lifecyclePhaseOverride as LifecyclePhase;
    }
    return this.detectLifecyclePhase(book.publicationDate);
  }

  /**
   * Retourne les infos de phase pour l'affichage frontend.
   */
  private getPhaseInfo(phase: LifecyclePhase, publicationDate: string | null): {
    phase: LifecyclePhase;
    label: string;
    emoji: string;
    explanation: string;
    color: string;
  } {
    const days = this.daysSincePublication(publicationDate);
    const daysText = days !== Infinity ? `${days} jour${days > 1 ? 's' : ''}` : '';

    const phaseInfoMap: Record<LifecyclePhase, { label: string; emoji: string; explanation: string; color: string }> = {
      launch: {
        label: 'Lancement',
        emoji: '🚀',
        explanation: daysText
          ? `En lancement depuis ${daysText}. On explore les mots-clés, on collecte des données. C'est normal que l'ACoS soit élevé — Amazon apprend qui sont tes lecteurs.`
          : 'Phase de lancement. On explore les mots-clés et on collecte des données. Tolérance haute sur l\'ACoS.',
        color: 'blue',
      },
      scale: {
        label: 'Croissance',
        emoji: '📈',
        explanation: 'Ton livre commence à trouver son public. On nettoie les mots-clés perdants, on pousse les gagnants, et on optimise le budget.',
        color: 'amber',
      },
      evergreen: {
        label: 'Régime de croisière',
        emoji: '🌿',
        explanation: 'Ton livre est bien installé. On maintient la rentabilité, on resserre l\'ACoS progressivement, et on surveille la concentration des ventes.',
        color: 'emerald',
      },
      relaunch: {
        label: 'Relance',
        emoji: '🔄',
        explanation: 'Mode relance activé. On traite ce livre comme un nouveau lancement : exploration large, tolérance haute, collecte de données fraîches.',
        color: 'purple',
      },
    };

    return {
      phase,
      ...phaseInfoMap[phase],
    };
  }

  // ─── Dashboard & Daily Metrics ─────────────────────

  /**
   * Calcule l'indice de dépendance publicitaire (0-100).
   *
   * Score élevé = le livre dépend beaucoup de la pub.
   * Score bas = le livre montre des signes de référencement organique.
   *
   * Basé uniquement sur les métriques Ads disponibles :
   * - ACoS (30%) : un ACoS élevé indique une forte dépendance
   * - CVR (25%) : un bon CVR suggère un produit solide (moins dépendant)
   * - CTR (20%) : un bon CTR montre de l'intérêt naturel
   * - Volume de commandes (15%) : plus il y a de commandes, plus le livre a un historique
   * - Volume d'impressions (10%) : un gros volume peut indiquer une position acquise
   *
   * Le score est lissé par des fonctions sigmoïdes pour éviter les variations brutales.
   */
  private computeAdsDependencyScore(kpis: {
    acos: number;
    ctr: number;
    cvr: number;
    orders: number;
    impressions: number;
    spend: number;
    sales: number;
  }): number {
    // Pas de données → pas de score
    if (kpis.spend === 0 && kpis.impressions === 0) return -1;

    // Fonction sigmoïde douce pour normaliser un score entre 0 et 1
    // center = point milieu, steepness = pente (plus élevé = transition plus raide)
    const sigmoid = (value: number, center: number, steepness: number): number => {
      return 1 / (1 + Math.exp(-steepness * (value - center)));
    };

    // ── Score ACoS (30%) ──
    // ACoS > 60% → très dépendant (score haut). ACoS < 15% → peu dépendant.
    // On inverse : ACoS élevé = score de dépendance élevé
    const acosScore = kpis.sales > 0
      ? sigmoid(kpis.acos, 40, 0.06) // centré à 40%, transition douce
      : 1.0; // pas de ventes = totalement dépendant

    // ── Score CVR (25%) ──
    // CVR élevé = les gens qui cliquent achètent = produit solide = moins dépendant
    // On inverse : CVR élevé = score bas (moins dépendant)
    const cvrScore = kpis.cvr > 0
      ? 1 - sigmoid(kpis.cvr, 8, 0.3) // centré à 8%, transition douce
      : 1.0; // pas de conversion = dépendant

    // ── Score CTR (20%) ──
    // CTR élevé = les gens sont intéressés = bon référencement
    // On inverse : CTR élevé = score bas
    const ctrScore = kpis.ctr > 0
      ? 1 - sigmoid(kpis.ctr, 0.4, 4) // centré à 0.4%
      : 1.0;

    // ── Score volume commandes (15%) ──
    // Plus de commandes = plus d'historique = le livre s'installe
    // On inverse : beaucoup de commandes = score bas
    const ordersScore = kpis.orders > 0
      ? 1 - sigmoid(kpis.orders, 15, 0.15) // centré à 15 commandes/mois
      : 1.0;

    // ── Score volume impressions (10%) ──
    // Un bon volume d'impressions avec un bon CTR indique une position acquise
    const impressionsScore = kpis.impressions > 0
      ? 1 - sigmoid(kpis.impressions, 5000, 0.0005) // centré à 5000 impressions
      : 1.0;

    // Score pondéré final (0 à 1) → converti en 0 à 100
    const rawScore =
      acosScore * 0.30 +
      cvrScore * 0.25 +
      ctrScore * 0.20 +
      ordersScore * 0.15 +
      impressionsScore * 0.10;

    return Math.round(rawScore * 100);
  }

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
   * Recupere les entity keys des campagnes liees a un livre
   */
  private async getCampaignEntityKeys(bookId: string): Promise<string[]> {
    const mappings = await this.db
      .select({ campaignId: campaignBookMapping.campaignId })
      .from(campaignBookMapping)
      .where(eq(campaignBookMapping.bookId, bookId));

    if (mappings.length === 0) return [];

    const campaignIds = mappings.map((m: any) => m.campaignId);

    const campaignData = await this.db
      .select({ amazonCampaignId: campaigns.amazonCampaignId })
      .from(campaigns)
      .where(inArray(campaigns.id, campaignIds));

    return campaignData.map((c: any) => `campaign:${c.amazonCampaignId}`);
  }

  /**
   * Agrege les metriques pour un ensemble d'entity keys
   */
  private async aggregateMetricsForKeys(
    entityKeys: string[],
    dateRange: { startDate: string; endDate: string },
  ): Promise<{
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    units: number;
  }> {
    if (entityKeys.length === 0) {
      return { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, units: 0 };
    }

    const [result] = await this.db
      .select({
        impressions: sql<number>`COALESCE(SUM(${dailyMetrics.impressions}), 0)`,
        clicks: sql<number>`COALESCE(SUM(${dailyMetrics.clicks}), 0)`,
        spend: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.spend} AS DECIMAL)), 0)`,
        sales: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.sales} AS DECIMAL)), 0)`,
        orders: sql<number>`COALESCE(SUM(${dailyMetrics.orders}), 0)`,
        units: sql<number>`COALESCE(SUM(${dailyMetrics.units}), 0)`,
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

    return {
      impressions: Number(result?.impressions || 0),
      clicks: Number(result?.clicks || 0),
      spend: Number(result?.spend || 0),
      sales: Number(result?.sales || 0),
      orders: Number(result?.orders || 0),
      units: Number(result?.units || 0),
    };
  }

  /**
   * GET /api/books/:id/dashboard
   * Dashboard complet d'un livre : KPIs + tendances + recos + actions + daily metrics
   */
  async getDashboard(bookId: string): Promise<any> {
    // 1. Recuperer le livre
    const [book] = await this.db
      .select()
      .from(books)
      .where(eq(books.id, bookId))
      .limit(1);

    if (!book) {
      throw new NotFoundException(`Book ${bookId} not found`);
    }

    const dateRange = this.getDefaultDateRange();
    const entityKeys = await this.getCampaignEntityKeys(bookId);

    // 2. Metriques periode courante (30j)
    const currentMetrics = await this.aggregateMetricsForKeys(entityKeys, dateRange);

    // 3. Metriques periode precedente (30j avant)
    const startDate = new Date(dateRange.startDate);
    const endDate = new Date(dateRange.endDate);
    const periodLength = endDate.getTime() - startDate.getTime();
    const prevStart = new Date(startDate.getTime() - periodLength - 86400000);
    const prevEnd = new Date(startDate.getTime() - 86400000);
    const prevDateRange = {
      startDate: prevStart.toISOString().split('T')[0],
      endDate: prevEnd.toISOString().split('T')[0],
    };
    const prevMetrics = await this.aggregateMetricsForKeys(entityKeys, prevDateRange);

    // 4. Calculer les KPIs
    const calculateKPIs = (m: typeof currentMetrics) => {
      const spend = m.spend;
      const sales = m.sales;
      const clicks = m.clicks;
      const impressions = m.impressions;
      const orders = m.orders;
      return {
        impressions,
        clicks,
        spend: Math.round(spend * 100) / 100,
        sales: Math.round(sales * 100) / 100,
        orders,
        units: m.units,
        acos: sales > 0 ? Math.round((spend / sales) * 10000) / 100 : 0,
        roas: spend > 0 ? Math.round((sales / spend) * 100) / 100 : 0,
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
        cvr: clicks > 0 ? Math.round((orders / clicks) * 10000) / 100 : 0,
        cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
      };
    };

    const kpis = calculateKPIs(currentMetrics);
    const prevKpis = calculateKPIs(prevMetrics);

    // 5. Tendances
    const calcChange = (current: number, previous: number): number | null => {
      if (previous === 0) return null;
      return Math.round(((current - previous) / previous) * 1000) / 10;
    };

    const changes: Record<string, number | null> = {
      impressions: calcChange(kpis.impressions, prevKpis.impressions),
      clicks: calcChange(kpis.clicks, prevKpis.clicks),
      spend: calcChange(kpis.spend, prevKpis.spend),
      sales: calcChange(kpis.sales, prevKpis.sales),
      orders: calcChange(kpis.orders, prevKpis.orders),
      acos: calcChange(kpis.acos, prevKpis.acos),
      roas: calcChange(kpis.roas, prevKpis.roas),
      ctr: calcChange(kpis.ctr, prevKpis.ctr),
      cvr: calcChange(kpis.cvr, prevKpis.cvr),
      cpc: calcChange(kpis.cpc, prevKpis.cpc),
    };

    // 6. Recommandations pending pour CE livre
    // On récupère les recos pour : campagnes, mots-clés et termes de recherche
    // liés aux campagnes de ce livre
    let recos: any[] = [];
    if (entityKeys.length > 0) {
      // Récupérer aussi les entityKeys des keywords liés aux campagnes du livre
      const bookCampaignIds = (await this.db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(inArray(campaigns.amazonCampaignId,
          entityKeys.map((k: string) => Number(k.replace('campaign:', '')))
        ))
      ).map((c: any) => c.id);

      let keywordEntityKeys: string[] = [];
      if (bookCampaignIds.length > 0) {
        const adGroupsData = await this.db
          .select({ id: adGroups.id })
          .from(adGroups)
          .where(inArray(adGroups.campaignId, bookCampaignIds));

        if (adGroupsData.length > 0) {
          const adGroupIds = adGroupsData.map((a: any) => a.id);
          const keywordsData = await this.db
            .select({ amazonKeywordId: keywords.amazonKeywordId })
            .from(keywords)
            .where(inArray(keywords.adGroupId, adGroupIds));

          keywordEntityKeys = keywordsData.map((k: any) => `keyword:${k.amazonKeywordId}`);
        }
      }

      // Combiner toutes les entityKeys possibles
      const allEntityKeys = [...entityKeys, ...keywordEntityKeys];

      recos = await this.db
        .select()
        .from(recommendations)
        .where(
          and(
            eq(recommendations.workspaceId, book.workspaceId),
            eq(recommendations.status, 'pending'),
            inArray(recommendations.entityKey, allEntityKeys),
          ),
        )
        .orderBy(desc(recommendations.createdAt))
        .limit(20);
    }

    // 6b. Résoudre les noms d'entités pour les recommandations
    // (campagnes, mots-clés, termes de recherche)
    const entityNameMap = new Map<string, string>();
    if (recos.length > 0) {
      // Grouper les entityKeys par type
      const campaignIds: number[] = [];
      const keywordIds: number[] = [];
      const searchTermQueries: string[] = [];

      for (const r of recos) {
        const key = (r as any).entityKey || '';
        if (key.startsWith('campaign:')) {
          const id = Number(key.replace('campaign:', ''));
          if (!isNaN(id)) campaignIds.push(id);
        } else if (key.startsWith('keyword:')) {
          const id = Number(key.replace('keyword:', ''));
          if (!isNaN(id)) keywordIds.push(id);
        } else if (key.startsWith('search_term:')) {
          searchTermQueries.push(key.replace('search_term:', ''));
        }
      }

      // Résoudre les noms de campagnes
      if (campaignIds.length > 0) {
        const campaignNames = await this.db
          .select({
            amazonCampaignId: campaigns.amazonCampaignId,
            name: campaigns.name,
          })
          .from(campaigns)
          .where(inArray(campaigns.amazonCampaignId, campaignIds));

        for (const c of campaignNames) {
          entityNameMap.set(`campaign:${c.amazonCampaignId}`, c.name);
        }
      }

      // Résoudre les noms de mots-clés
      if (keywordIds.length > 0) {
        const keywordNames = await this.db
          .select({
            amazonKeywordId: keywords.amazonKeywordId,
            keywordText: keywords.keywordText,
            matchType: keywords.matchType,
          })
          .from(keywords)
          .where(inArray(keywords.amazonKeywordId, keywordIds));

        for (const k of keywordNames) {
          const label = k.matchType
            ? `${k.keywordText} (${k.matchType})`
            : k.keywordText;
          entityNameMap.set(`keyword:${k.amazonKeywordId}`, label);
        }
      }

      // Résoudre les termes de recherche (entityKey = search_term:{query})
      // Pour les search_terms, l'entityKey contient déjà le texte de la requête
      // mais on nettoie quand même
      for (const q of searchTermQueries) {
        entityNameMap.set(`search_term:${q}`, `« ${q} »`);
      }
    }

    // 7. Actions recentes
    const recentActions = await this.db
      .select()
      .from(actionLog)
      .where(eq(actionLog.workspaceId, book.workspaceId))
      .orderBy(desc(actionLog.executedAt))
      .limit(20);

    // 8. Daily metrics (30 jours) pour le graphique
    let dailyData: any[] = [];
    if (entityKeys.length > 0) {
      dailyData = await this.db
        .select({
          date: dailyMetrics.date,
          spend: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.spend} AS DECIMAL)), 0)`,
          sales: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.sales} AS DECIMAL)), 0)`,
          impressions: sql<number>`COALESCE(SUM(${dailyMetrics.impressions}), 0)`,
          clicks: sql<number>`COALESCE(SUM(${dailyMetrics.clicks}), 0)`,
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
        )
        .groupBy(dailyMetrics.date)
        .orderBy(dailyMetrics.date);
    }

    // ── Indice de dépendance publicitaire ──
    const adsDependencyScore = this.computeAdsDependencyScore(kpis);

    // ── Phase de cycle de vie ──
    const lifecyclePhase = this.getEffectiveLifecyclePhase(book);
    const phaseInfo = this.getPhaseInfo(lifecyclePhase, book.publicationDate);

    return {
      book: {
        id: book.id,
        title: book.title || book.asin,
        asin: book.asin,
        author: book.author || 'Auteur inconnu',
        marketplace: book.marketplace,
        publicationDate: book.publicationDate || null,
        acosTarget: book.acosTarget ? Number(book.acosTarget) : 40,
        royaltyRate: book.royaltyRate ? Number(book.royaltyRate) : null,
        salePrice: book.salePrice ? Number(book.salePrice) : null,
        royaltyPerUnit: book.royaltyPerUnit ? Number(book.royaltyPerUnit) : null,
        lifecyclePhaseOverride: book.lifecyclePhaseOverride || null,
        lifecyclePhase,
        phaseInfo,
      },
      adsDependencyScore,
      metrics: kpis,
      trends: { changes },
      recommendations: recos.map((r: any) => {
        const entityKey = r.entityKey || '';
        // Résoudre le nom ou fallback lisible
        let entityName = entityNameMap.get(entityKey);
        if (!entityName) {
          // Fallback : extraire la partie après le ":" et rendre lisible
          const parts = entityKey.split(':');
          if (parts.length === 2) {
            entityName = `${parts[0] === 'campaign' ? 'Campagne' : parts[0] === 'keyword' ? 'Mot-clé' : 'Terme'} #${parts[1]}`;
          } else {
            entityName = entityKey;
          }
        }
        return {
          id: r.id,
          entityType: r.entityType,
          entityKey: r.entityKey,
          entityName,
          actionType: r.actionType,
          suggestedAction: r.suggestedAction,
          contextData: r.contextData,
          confidenceScore: r.confidenceScore ? Number(r.confidenceScore) : null,
          ruleSnapshot: r.ruleSnapshot,
          status: r.status,
          createdAt: r.createdAt,
        };
      }),
      recentActions: recentActions.map((a: any) => ({
        id: a.id,
        entityType: a.entityType,
        entityKey: a.entityKey,
        actionType: a.actionType,
        rationale: a.rationale,
        status: a.status,
        dryRun: a.dryRun,
        executedBy: a.executedBy,
        createdAt: a.executedAt,
        beforeValue: a.beforeValue,
        afterValue: a.afterValue,
      })),
      dailyMetrics: dailyData.map((d: any) => ({
        date: d.date,
        spend: Math.round(Number(d.spend) * 100) / 100,
        sales: Math.round(Number(d.sales) * 100) / 100,
        acos: Number(d.sales) > 0
          ? Math.round((Number(d.spend) / Number(d.sales)) * 10000) / 100
          : 0,
        impressions: Number(d.impressions),
        clicks: Number(d.clicks),
        orders: Number(d.orders),
      })),
    };
  }

  /**
   * GET /api/books/:id/metrics/daily?days=30
   * Donnees journalieres pour le graphique
   */
  async getDailyMetrics(bookId: string, days: number = 30): Promise<any[]> {
    const [book] = await this.db
      .select()
      .from(books)
      .where(eq(books.id, bookId))
      .limit(1);

    if (!book) {
      throw new NotFoundException(`Book ${bookId} not found`);
    }

    const entityKeys = await this.getCampaignEntityKeys(bookId);

    if (entityKeys.length === 0) {
      return [];
    }

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    const dailyData = await this.db
      .select({
        date: dailyMetrics.date,
        impressions: sql<number>`COALESCE(SUM(${dailyMetrics.impressions}), 0)`,
        clicks: sql<number>`COALESCE(SUM(${dailyMetrics.clicks}), 0)`,
        spend: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.spend} AS DECIMAL)), 0)`,
        sales: sql<number>`COALESCE(SUM(CAST(${dailyMetrics.sales} AS DECIMAL)), 0)`,
        orders: sql<number>`COALESCE(SUM(${dailyMetrics.orders}), 0)`,
        units: sql<number>`COALESCE(SUM(${dailyMetrics.units}), 0)`,
      })
      .from(dailyMetrics)
      .where(
        and(
          eq(dailyMetrics.entityType, 'campaign'),
          inArray(dailyMetrics.entityKey, entityKeys),
          gte(dailyMetrics.date, start.toISOString().split('T')[0]),
          lte(dailyMetrics.date, end.toISOString().split('T')[0]),
        ),
      )
      .groupBy(dailyMetrics.date)
      .orderBy(dailyMetrics.date);

    return dailyData.map((d: any) => ({
      date: d.date,
      impressions: Number(d.impressions),
      clicks: Number(d.clicks),
      spend: Math.round(Number(d.spend) * 100) / 100,
      sales: Math.round(Number(d.sales) * 100) / 100,
      orders: Number(d.orders),
      units: Number(d.units),
      acos: Number(d.sales) > 0
        ? Math.round((Number(d.spend) / Number(d.sales)) * 10000) / 100
        : 0,
    }));
  }
}
