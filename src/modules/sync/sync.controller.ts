import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Logger,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SyncService, SyncOptions, SyncResult, SyncStatusResponse, SyncType, SyncEntity } from './sync.service';

interface TriggerSyncDto {
  adAccountId: string;
  profileId?: string;
  syncType?: SyncType;
  entities?: SyncEntity[];
}

interface SyncStatusQueryDto {
  adAccountId: string;
}

@Controller('api/sync')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(private readonly syncService: SyncService) {}

  /**
   * POST /api/sync/trigger
   * Declenche une synchronisation pour un ad account
   *
   * Body:
   * - adAccountId: string (required) - ID du ad account a synchroniser
   * - profileId?: string - Optionnel, pour sync un profil specifique
   * - syncType?: 'full' | 'incremental' - Type de sync (default: full)
   * - entities?: string[] - Entites a synchroniser (default: all)
   */
  @Post('trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerSync(@Body() body: TriggerSyncDto): Promise<{
    message: string;
    syncLogId: string;
    result: SyncResult;
  }> {
    if (!body.adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    // Valider le syncType
    const validSyncTypes: SyncType[] = ['full', 'incremental'];
    const syncType = body.syncType || 'full';
    if (!validSyncTypes.includes(syncType)) {
      throw new BadRequestException(`Invalid syncType. Must be one of: ${validSyncTypes.join(', ')}`);
    }

    // Valider les entities si fournies
    const validEntities: SyncEntity[] = ['profiles', 'portfolios', 'campaigns', 'ad_groups', 'keywords', 'product_targets'];
    if (body.entities) {
      for (const entity of body.entities) {
        if (!validEntities.includes(entity)) {
          throw new BadRequestException(`Invalid entity: ${entity}. Must be one of: ${validEntities.join(', ')}`);
        }
      }
    }

    this.logger.log(
      `Triggering ${syncType} sync for ad account ${body.adAccountId}` +
      (body.profileId ? ` (profile: ${body.profileId})` : '') +
      (body.entities ? ` (entities: ${body.entities.join(', ')})` : ' (all entities)')
    );

    try {
      const options: SyncOptions = {
        adAccountId: body.adAccountId,
        profileId: body.profileId,
        syncType,
        entities: body.entities,
      };

      const result = await this.syncService.triggerSync(options);

      return {
        message: `Sync ${result.status === 'success' ? 'completed successfully' : result.status === 'partial' ? 'completed with some errors' : 'failed'}`,
        syncLogId: result.syncLogId,
        result,
      };
    } catch (error) {
      this.logger.error(`Failed to trigger sync: ${error}`);

      if (error instanceof Error && error.message.includes('already in progress')) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  /**
   * POST /api/sync/trigger/:adAccountId
   * Alternative: declenche une sync via parametre URL
   */
  @Post('trigger/:adAccountId')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerSyncByParam(
    @Param('adAccountId') adAccountId: string,
    @Body() body: Omit<TriggerSyncDto, 'adAccountId'>,
  ): Promise<{
    message: string;
    syncLogId: string;
    result: SyncResult;
  }> {
    return this.triggerSync({
      adAccountId,
      ...body,
    });
  }

  /**
   * GET /api/sync/status
   * Recupere le statut de synchronisation d'un ad account
   *
   * Query params:
   * - adAccountId: string (required) - ID du ad account
   */
  @Get('status')
  async getSyncStatus(@Query() query: SyncStatusQueryDto): Promise<SyncStatusResponse> {
    if (!query.adAccountId) {
      throw new BadRequestException('adAccountId query parameter is required');
    }

    this.logger.debug(`Getting sync status for ad account ${query.adAccountId}`);

    try {
      return await this.syncService.getSyncStatus(query.adAccountId);
    } catch (error) {
      this.logger.error(`Failed to get sync status: ${error}`);

      if (error instanceof Error && error.message.includes('not found')) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  /**
   * GET /api/sync/status/:adAccountId
   * Alternative: recupere le statut via parametre URL
   */
  @Get('status/:adAccountId')
  async getSyncStatusByParam(
    @Param('adAccountId') adAccountId: string,
  ): Promise<SyncStatusResponse> {
    return this.getSyncStatus({ adAccountId });
  }

  /**
   * POST /api/sync/profiles
   * Synchronise uniquement les profils marketplace
   */
  @Post('profiles')
  @HttpCode(HttpStatus.ACCEPTED)
  async syncProfiles(@Body() body: { adAccountId: string }): Promise<{
    message: string;
    result: SyncResult;
  }> {
    if (!body.adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    this.logger.log(`Syncing profiles for ad account ${body.adAccountId}`);

    const result = await this.syncService.triggerSync({
      adAccountId: body.adAccountId,
      syncType: 'full',
      entities: ['profiles'],
    });

    return {
      message: result.status === 'success' ? 'Profiles synced successfully' : 'Profile sync completed with issues',
      result,
    };
  }

  /**
   * POST /api/sync/campaigns
   * Synchronise uniquement les campagnes
   */
  @Post('campaigns')
  @HttpCode(HttpStatus.ACCEPTED)
  async syncCampaigns(@Body() body: { adAccountId: string; profileId?: string }): Promise<{
    message: string;
    result: SyncResult;
  }> {
    if (!body.adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    this.logger.log(`Syncing campaigns for ad account ${body.adAccountId}`);

    const result = await this.syncService.triggerSync({
      adAccountId: body.adAccountId,
      profileId: body.profileId,
      syncType: 'full',
      entities: ['campaigns'],
    });

    return {
      message: result.status === 'success' ? 'Campaigns synced successfully' : 'Campaign sync completed with issues',
      result,
    };
  }

  /**
   * POST /api/sync/keywords
   * Synchronise uniquement les keywords
   */
  @Post('keywords')
  @HttpCode(HttpStatus.ACCEPTED)
  async syncKeywords(@Body() body: { adAccountId: string; profileId?: string }): Promise<{
    message: string;
    result: SyncResult;
  }> {
    if (!body.adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    this.logger.log(`Syncing keywords for ad account ${body.adAccountId}`);

    const result = await this.syncService.triggerSync({
      adAccountId: body.adAccountId,
      profileId: body.profileId,
      syncType: 'full',
      entities: ['keywords'],
    });

    return {
      message: result.status === 'success' ? 'Keywords synced successfully' : 'Keyword sync completed with issues',
      result,
    };
  }
}
