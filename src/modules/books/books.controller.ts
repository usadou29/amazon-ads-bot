import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { BooksService, CreateBookDto, UpdateBookDto, MapCampaignDto } from './books.service';

@Controller('api/books')
export class BooksController {
  private readonly logger = new Logger(BooksController.name);

  constructor(private readonly booksService: BooksService) {}

  /**
   * GET /api/books
   * Recupere tous les livres d'un workspace
   */
  @Get()
  async findAll(@Query('workspaceId') workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    this.logger.log(`Fetching all books for workspace ${workspaceId}`);

    return this.booksService.findAll(workspaceId);
  }

  /**
   * GET /api/books/:id
   * Recupere un livre par ID avec ses campagnes associees
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    if (!id) {
      throw new BadRequestException('Book ID is required');
    }

    this.logger.log(`Fetching book ${id}`);

    return this.booksService.findOne(id);
  }

  /**
   * POST /api/books
   * Cree un nouveau livre
   */
  @Post()
  async create(@Body() body: CreateBookDto) {
    if (!body.workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    if (!body.asin) {
      throw new BadRequestException('asin is required');
    }

    if (!body.marketplace) {
      throw new BadRequestException('marketplace is required');
    }

    this.logger.log(`Creating book with ASIN ${body.asin} for workspace ${body.workspaceId}`);

    return this.booksService.create(body);
  }

  /**
   * PATCH /api/books/:id
   * Met a jour un livre
   */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateBookDto) {
    if (!id) {
      throw new BadRequestException('Book ID is required');
    }

    this.logger.log(`Updating book ${id}`);

    return this.booksService.update(id, body);
  }

  /**
   * DELETE /api/books/:id
   * Supprime un livre
   */
  @Delete(':id')
  async delete(@Param('id') id: string) {
    if (!id) {
      throw new BadRequestException('Book ID is required');
    }

    this.logger.log(`Deleting book ${id}`);

    await this.booksService.delete(id);

    return { success: true, message: `Book ${id} deleted` };
  }

  /**
   * POST /api/books/:id/campaigns
   * Associe une campagne a un livre
   */
  @Post(':id/campaigns')
  async mapCampaign(
    @Param('id') bookId: string,
    @Body() body: { campaignId: string; isPrimary?: boolean; notes?: string },
  ) {
    if (!bookId) {
      throw new BadRequestException('Book ID is required');
    }

    if (!body.campaignId) {
      throw new BadRequestException('campaignId is required');
    }

    this.logger.log(`Mapping campaign ${body.campaignId} to book ${bookId}`);

    const dto: MapCampaignDto = {
      bookId,
      campaignId: body.campaignId,
      isPrimary: body.isPrimary,
      notes: body.notes,
    };

    return this.booksService.mapCampaign(dto);
  }

  /**
   * DELETE /api/books/:id/campaigns/:campaignId
   * Retire l'association d'une campagne a un livre
   */
  @Delete(':id/campaigns/:campaignId')
  async unmapCampaign(
    @Param('id') bookId: string,
    @Param('campaignId') campaignId: string,
  ) {
    if (!bookId) {
      throw new BadRequestException('Book ID is required');
    }

    if (!campaignId) {
      throw new BadRequestException('Campaign ID is required');
    }

    this.logger.log(`Unmapping campaign ${campaignId} from book ${bookId}`);

    await this.booksService.unmapCampaign(bookId, campaignId);

    return { success: true, message: `Campaign ${campaignId} unmapped from book ${bookId}` };
  }

  /**
   * GET /api/books/available-campaigns
   * Recupere les campagnes disponibles pour mapping
   */
  @Get('available-campaigns')
  async getAvailableCampaigns(
    @Query('workspaceId') workspaceId: string,
    @Query('bookId') bookId?: string,
  ) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    this.logger.log(`Fetching available campaigns for workspace ${workspaceId}`);

    return this.booksService.getAvailableCampaigns(workspaceId, bookId);
  }
}
