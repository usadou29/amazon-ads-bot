import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ExecutorService, ExecuteActionResult, ExecuteBatchResult, ActionLogQuery } from './executor.service';

// ============================================
// DTOs
// ============================================

class ExecuteActionDto {
  recommendationId!: string;
  dryRun?: boolean;
  executedBy?: 'system' | 'user' | 'manual';
}

class ExecuteBatchDto {
  recommendationIds!: string[];
  dryRun?: boolean;
  executedBy?: 'system' | 'user' | 'manual';
  stopOnError?: boolean;
}

class KillSwitchDto {
  enabled!: boolean;
  reason?: string;
  enabledBy?: string;
}

class ActionLogQueryDto {
  workspaceId?: string;
  entityType?: string;
  entityKey?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

// ============================================
// CONTROLLER
// ============================================

@Controller('api/actions')
export class ExecutorController {
  private readonly logger = new Logger(ExecutorController.name);

  constructor(private readonly executorService: ExecutorService) {}

  /**
   * Execute une recommandation approuvee
   * POST /api/actions/execute
   */
  @Post('execute')
  @HttpCode(HttpStatus.OK)
  async executeAction(@Body() dto: ExecuteActionDto): Promise<{
    success: boolean;
    result: ExecuteActionResult;
  }> {
    this.logger.log(`Execute action request for recommendation ${dto.recommendationId}`);

    const result = await this.executorService.executeAction({
      recommendationId: dto.recommendationId,
      dryRun: dto.dryRun ?? false,
      executedBy: dto.executedBy ?? 'user',
    });

    return {
      success: result.success,
      result,
    };
  }

  /**
   * Execute un batch de recommandations
   * POST /api/actions/execute-batch
   */
  @Post('execute-batch')
  @HttpCode(HttpStatus.OK)
  async executeBatch(@Body() dto: ExecuteBatchDto): Promise<{
    success: boolean;
    result: ExecuteBatchResult;
  }> {
    this.logger.log(`Execute batch request for ${dto.recommendationIds.length} recommendations`);

    const result = await this.executorService.executeBatch({
      recommendationIds: dto.recommendationIds,
      dryRun: dto.dryRun ?? false,
      executedBy: dto.executedBy ?? 'user',
      stopOnError: dto.stopOnError ?? false,
    });

    return {
      success: result.failed === 0,
      result,
    };
  }

  /**
   * Recupere le log des actions
   * GET /api/actions/log
   */
  @Get('log')
  async getActionLog(@Query() query: ActionLogQueryDto): Promise<{
    data: any[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const logQuery: ActionLogQuery = {
      workspaceId: query.workspaceId,
      entityType: query.entityType,
      entityKey: query.entityKey,
      status: query.status,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      limit: query.limit ? Number(query.limit) : 50,
      offset: query.offset ? Number(query.offset) : 0,
    };

    const result = await this.executorService.getActionLog(logQuery);

    return {
      data: result.data,
      total: result.total,
      page: Math.floor((logQuery.offset || 0) / (logQuery.limit || 50)) + 1,
      pageSize: logQuery.limit || 50,
    };
  }

  /**
   * Recupere une action par ID
   * GET /api/actions/log/:id
   */
  @Get('log/:id')
  async getActionById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: any | null }> {
    const action = await this.executorService.getActionById(id);
    return { data: action };
  }

  /**
   * Verifie le statut du kill switch
   * GET /api/actions/kill-switch
   */
  @Get('kill-switch')
  async getKillSwitchStatus(): Promise<{
    active: boolean;
    reason?: string;
  }> {
    return this.executorService.isKillSwitchActive();
  }

  /**
   * Active ou desactive le kill switch
   * POST /api/actions/kill-switch
   */
  @Post('kill-switch')
  @HttpCode(HttpStatus.OK)
  async setKillSwitch(@Body() dto: KillSwitchDto): Promise<{
    success: boolean;
    message: string;
  }> {
    if (dto.enabled) {
      if (!dto.reason) {
        return {
          success: false,
          message: 'A reason is required to enable the kill switch',
        };
      }
      await this.executorService.enableKillSwitch(
        dto.reason,
        dto.enabledBy || 'api',
      );
      return {
        success: true,
        message: `Kill switch enabled: ${dto.reason}`,
      };
    } else {
      await this.executorService.disableKillSwitch();
      return {
        success: true,
        message: 'Kill switch disabled',
      };
    }
  }

  /**
   * Dry run d'une recommandation
   * POST /api/actions/dry-run
   */
  @Post('dry-run')
  @HttpCode(HttpStatus.OK)
  async dryRun(@Body() dto: ExecuteActionDto): Promise<{
    success: boolean;
    result: ExecuteActionResult;
  }> {
    this.logger.log(`Dry run request for recommendation ${dto.recommendationId}`);

    const result = await this.executorService.executeAction({
      recommendationId: dto.recommendationId,
      dryRun: true,
      executedBy: dto.executedBy ?? 'user',
    });

    return {
      success: result.success,
      result,
    };
  }
}
