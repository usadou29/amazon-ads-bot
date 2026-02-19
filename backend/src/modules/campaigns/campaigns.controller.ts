import {
  Controller,
  Get,
  Query,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

@Controller('api/campaigns')
export class CampaignsController {
  private readonly logger = new Logger(CampaignsController.name);

  constructor(private readonly campaignsService: CampaignsService) {}

  /**
   * GET /api/campaigns?workspaceId=X
   * Liste toutes les campagnes d'un workspace
   */
  @Get()
  async findAll(@Query('workspaceId') workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    this.logger.log(`Fetching campaigns for workspace ${workspaceId}`);

    return this.campaignsService.findAll(workspaceId);
  }

  /**
   * GET /api/campaigns/count?workspaceId=X
   * Compte les campagnes d'un workspace
   */
  @Get('count')
  async count(@Query('workspaceId') workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    return this.campaignsService.count(workspaceId);
  }
}
