import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { books, campaigns, campaignBookMapping } from '@/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import type { Book, NewBook, CampaignBookMapping } from '@/db/schema';

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
}
