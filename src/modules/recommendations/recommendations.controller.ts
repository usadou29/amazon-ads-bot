import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import {
  RecommendationsService,
  RecommendationFilter,
  ApproveRecommendationDto,
  RejectRecommendationDto,
} from './recommendations.service';
import type { RecommendationStatus } from '@/db/schema/recommendations';

@Controller('api/recommendations')
export class RecommendationsController {
  private readonly logger = new Logger(RecommendationsController.name);

  constructor(private readonly recommendationsService: RecommendationsService) {}

  /**
   * GET /api/recommendations
   * Recupere les recommandations avec filtres
   */
  @Get()
  async findAll(
    @Query('workspaceId') workspaceId: string,
    @Query('status') status?: string,
    @Query('entityType') entityType?: string,
    @Query('ruleId') ruleId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    this.logger.log(`Fetching recommendations for workspace ${workspaceId}`);

    const filter: RecommendationFilter = {
      workspaceId,
      entityType,
      ruleId,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    };

    // Parser le status (peut etre une valeur unique ou une liste separee par des virgules)
    if (status) {
      const statuses = status.split(',') as RecommendationStatus[];
      filter.status = statuses.length === 1 ? statuses[0] : statuses;
    }

    return this.recommendationsService.findAll(filter);
  }

  /**
   * GET /api/recommendations/pending
   * Recupere uniquement les recommandations en attente
   */
  @Get('pending')
  async findPending(
    @Query('workspaceId') workspaceId: string,
    @Query('entityType') entityType?: string,
    @Query('limit') limit?: string,
  ) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    this.logger.log(`Fetching pending recommendations for workspace ${workspaceId}`);

    const filter: RecommendationFilter = {
      workspaceId,
      status: 'pending',
      entityType,
      limit: limit ? parseInt(limit, 10) : 50,
    };

    return this.recommendationsService.findAll(filter);
  }

  /**
   * GET /api/recommendations/stats
   * Recupere les statistiques des recommandations
   */
  @Get('stats')
  async getStats(@Query('workspaceId') workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    this.logger.log(`Fetching recommendation stats for workspace ${workspaceId}`);

    return this.recommendationsService.getStats(workspaceId);
  }

  /**
   * GET /api/recommendations/:id
   * Recupere une recommandation par ID
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    if (!id) {
      throw new BadRequestException('Recommendation ID is required');
    }

    this.logger.log(`Fetching recommendation ${id}`);

    return this.recommendationsService.findOne(id);
  }

  /**
   * POST /api/recommendations/:id/approve
   * Approuve une recommandation
   */
  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Body() body: ApproveRecommendationDto,
  ) {
    if (!id) {
      throw new BadRequestException('Recommendation ID is required');
    }

    this.logger.log(`Approving recommendation ${id}`);

    return this.recommendationsService.approve(id, body);
  }

  /**
   * POST /api/recommendations/:id/reject
   * Rejette une recommandation
   */
  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: RejectRecommendationDto,
  ) {
    if (!id) {
      throw new BadRequestException('Recommendation ID is required');
    }

    this.logger.log(`Rejecting recommendation ${id}`);

    return this.recommendationsService.reject(id, body);
  }

  /**
   * POST /api/recommendations/:id/skip
   * Skip une recommandation (sans la rejeter formellement)
   */
  @Post(':id/skip')
  async skip(
    @Param('id') id: string,
    @Body() body: { reviewedBy?: string },
  ) {
    if (!id) {
      throw new BadRequestException('Recommendation ID is required');
    }

    this.logger.log(`Skipping recommendation ${id}`);

    return this.recommendationsService.skip(id, body.reviewedBy);
  }

  /**
   * POST /api/recommendations/bulk/approve
   * Approuve plusieurs recommandations en masse
   */
  @Post('bulk/approve')
  async bulkApprove(
    @Body() body: { ids: string[]; reviewedBy?: string },
  ) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      throw new BadRequestException('ids array is required and must not be empty');
    }

    if (body.ids.length > 100) {
      throw new BadRequestException('Cannot approve more than 100 recommendations at once');
    }

    this.logger.log(`Bulk approving ${body.ids.length} recommendations`);

    return this.recommendationsService.bulkApprove(body.ids, {
      reviewedBy: body.reviewedBy,
    });
  }

  /**
   * POST /api/recommendations/bulk/reject
   * Rejette plusieurs recommandations en masse
   */
  @Post('bulk/reject')
  async bulkReject(
    @Body() body: { ids: string[]; reviewedBy?: string; reason?: string },
  ) {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      throw new BadRequestException('ids array is required and must not be empty');
    }

    if (body.ids.length > 100) {
      throw new BadRequestException('Cannot reject more than 100 recommendations at once');
    }

    this.logger.log(`Bulk rejecting ${body.ids.length} recommendations`);

    return this.recommendationsService.bulkReject(body.ids, {
      reviewedBy: body.reviewedBy,
      reason: body.reason,
    });
  }

  /**
   * POST /api/recommendations/expire
   * Expire les recommandations dont la date d'expiration est passee
   */
  @Post('expire')
  async expireOld() {
    this.logger.log('Running recommendation expiration');

    const count = await this.recommendationsService.expireOldRecommendations();

    return { expired: count };
  }

  /**
   * POST /api/recommendations/cleanup
   * Nettoie les anciennes recommandations
   */
  @Post('cleanup')
  async cleanup(@Body() body: { daysToKeep?: number }) {
    const daysToKeep = body.daysToKeep || 90;

    this.logger.log(`Running recommendation cleanup (keeping ${daysToKeep} days)`);

    const count = await this.recommendationsService.cleanupOld(daysToKeep);

    return { cleaned: count };
  }
}
