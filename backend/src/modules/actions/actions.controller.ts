import { Controller, Post, Body, Logger } from '@nestjs/common';
import { ActionSuggestionService } from './action-suggestion.service';
import { ActionSuggestionDto, ExecuteDirectActionDto } from './action-suggestion.dto';
import { ExecutorService } from '@/modules/executor/executor.service';

@Controller('api/actions')
export class ActionsController {
  private readonly logger = new Logger(ActionsController.name);

  constructor(
    private readonly suggestionService: ActionSuggestionService,
    private readonly executorService: ExecutorService,
  ) {}

  /**
   * POST /api/actions/suggestion
   * Calcule la suggestion d'action pour une entité (read-only)
   */
  @Post('suggestion')
  async getActionSuggestion(@Body() dto: ActionSuggestionDto) {
    this.logger.log(`Action suggestion for ${dto.entityKey} (${dto.entityType})`);
    return this.suggestionService.getActionSuggestion(dto);
  }

  /**
   * POST /api/actions/execute-direct
   * Exécute une action directe (sans recommendation)
   */
  @Post('execute-direct')
  async executeDirectAction(@Body() dto: ExecuteDirectActionDto) {
    this.logger.log(`Direct action ${dto.actionType} on ${dto.entityKey} (${dto.entityType})`);
    return this.executorService.executeDirectAction(dto);
  }
}
