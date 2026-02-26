import {
  Controller,
  Post,
  Param,
  Body,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { MacroSuggestionService } from './macro-suggestion.service';
import { MacroExecutorService } from './macro-executor.service';
import type { MacroSuggestionRequest, MacroExecuteRequest } from './macro.types';

@Controller('api/campaigns')
export class MacroController {
  private readonly logger = new Logger(MacroController.name);

  constructor(
    private readonly macroSuggestionService: MacroSuggestionService,
    private readonly macroExecutorService: MacroExecutorService,
  ) {}

  /**
   * POST /api/campaigns/:campaignId/macro-suggestions
   * Retourne les suggestions macro pour une campagne
   */
  @Post(':campaignId/macro-suggestions')
  async getMacroSuggestions(
    @Param('campaignId') campaignId: string,
    @Body() body: MacroSuggestionRequest,
  ) {
    if (!campaignId) {
      throw new BadRequestException('campaignId is required');
    }
    if (!body.bookId) {
      throw new BadRequestException('bookId is required');
    }
    if (!body.lifecyclePhase) {
      throw new BadRequestException('lifecyclePhase is required');
    }

    this.logger.log(`Fetching macro suggestions for campaign ${campaignId}`);

    return this.macroSuggestionService.getMacroSuggestions(campaignId, body);
  }

  /**
   * POST /api/campaigns/macro-execute
   * Exécute une action macro sur une campagne
   */
  @Post('macro-execute')
  async executeMacroAction(
    @Body() body: MacroExecuteRequest,
  ) {
    if (!body.workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }
    if (!body.campaignId) {
      throw new BadRequestException('campaignId is required');
    }
    if (!body.actionType) {
      throw new BadRequestException('actionType is required');
    }

    this.logger.log(`Executing macro action ${body.actionType} on campaign ${body.campaignId}`);

    return this.macroExecutorService.execute(body);
  }
}
