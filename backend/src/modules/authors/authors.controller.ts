import {
  Controller,
  Get,
  Param,
  Query,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { AuthorsService } from './authors.service';

@Controller('api/authors')
export class AuthorsController {
  private readonly logger = new Logger(AuthorsController.name);

  constructor(private readonly authorsService: AuthorsService) {}

  /**
   * GET /api/authors?workspaceId=X
   * Liste les auteurs avec KPIs agreges (30 jours)
   */
  @Get()
  async findAll(@Query('workspaceId') workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    this.logger.log(`Fetching authors for workspace ${workspaceId}`);

    return this.authorsService.findAll(workspaceId);
  }

  /**
   * GET /api/authors/:authorId/books?workspaceId=X
   * Liste les livres d'un auteur avec KPIs individuels
   */
  @Get(':authorId/books')
  async findBooksByAuthor(
    @Param('authorId') authorId: string,
    @Query('workspaceId') workspaceId: string,
  ) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    if (!authorId) {
      throw new BadRequestException('authorId is required');
    }

    this.logger.log(`Fetching books for author ${authorId} in workspace ${workspaceId}`);

    return this.authorsService.findBooksByAuthor(authorId, workspaceId);
  }
}
