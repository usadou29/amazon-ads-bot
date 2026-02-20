import {
  Controller,
  Post,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

@Controller('api/scheduler')
export class SchedulerController {
  private readonly logger = new Logger(SchedulerController.name);

  constructor(private readonly schedulerService: SchedulerService) {}

  /**
   * POST /api/scheduler/sync?workspaceId=X
   * Triggers a full sync for a workspace (structural + reports)
   * Fire-and-forget: returns immediately with 202, sync runs in background
   */
  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  async syncWorkspace(@Query('workspaceId') workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    // Check if a sync is already running
    const status = await this.schedulerService.getWorkspaceSyncStatus(workspaceId);
    if (status.syncInProgress) {
      return {
        message: 'Synchronisation déjà en cours',
        status: 'already_running',
      };
    }

    this.logger.log(`Manual sync triggered for workspace ${workspaceId}`);

    // Fire and forget — don't await
    this.schedulerService.syncByWorkspace(workspaceId).then((result) => {
      this.logger.log(
        `[MANUAL] Sync finished for workspace ${workspaceId}: ${result.status} — ` +
        `${result.accounts.map((a) => `${a.adAccountId}:${a.status}`).join(', ')}`,
      );
    }).catch((err) => {
      this.logger.error(
        `[MANUAL] Sync failed for workspace ${workspaceId}: ${err instanceof Error ? err.message : err}`,
      );
    });

    return {
      message: 'Synchronisation lancée en arrière-plan',
      status: 'started',
      adAccountCount: status.adAccountCount,
    };
  }

  /**
   * GET /api/scheduler/status?workspaceId=X
   * Returns sync status for a workspace (last sync date, in progress, etc.)
   */
  @Get('status')
  async getSyncStatus(@Query('workspaceId') workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    return this.schedulerService.getWorkspaceSyncStatus(workspaceId);
  }

  /**
   * GET /api/scheduler/diagnostic?workspaceId=X
   * Returns full diagnostic info about the sync pipeline
   */
  @Get('diagnostic')
  async getDiagnostic(@Query('workspaceId') workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    return this.schedulerService.getDiagnostic(workspaceId);
  }
}
