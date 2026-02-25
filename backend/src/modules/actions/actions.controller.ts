import { Controller, Post, Body, Logger } from '@nestjs/common';
import { ActionSuggestionService } from './action-suggestion.service';
import {
  ActionSuggestionDto,
  ExecuteDirectActionDto,
  BatchSuggestionsDto,
  BatchExecuteDirectDto,
} from './action-suggestion.dto';
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

  /**
   * POST /api/actions/batch-suggestions
   * Calcule les suggestions d'actions pour plusieurs entités en parallèle
   */
  @Post('batch-suggestions')
  async getBatchSuggestions(@Body() dto: BatchSuggestionsDto) {
    this.logger.log(
      `Batch suggestions for ${dto.entities.length} entities in workspace ${dto.workspaceId}`,
    );

    const suggestionPromises = dto.entities.map((entity) =>
      this.suggestionService.getActionSuggestion({
        workspaceId: dto.workspaceId,
        entityKey: entity.entityKey,
        entityType: entity.entityType,
        acosTarget: dto.acosTarget,
        lifecyclePhase: dto.lifecyclePhase,
      }),
    );

    const results = await Promise.allSettled(suggestionPromises);

    const suggestions: any[] = [];
    const errors: { entityKey: string; error: string }[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const r = result.value;
        // Transform to simplified BatchSuggestionItem for frontend
        const hasCooldown = r.cooldown?.active === true;
        const calc = r.bidCalculation;
        const recommendedBid = calc?.recommendedBid ?? null;

        // Eligibility: eligible if not cooldown, not insufficient_data, not observe_only
        const eligibilityStr = r.eligibility as string;
        const eligible = !hasCooldown
          && eligibilityStr !== 'insufficient_data'
          && eligibilityStr !== 'cooldown'
          && recommendedBid !== null;

        // Direction: derive from bid comparison
        let direction: 'bid_up' | 'bid_down' | null = null;
        if (recommendedBid !== null && r.currentBid > 0) {
          direction = recommendedBid > r.currentBid ? 'bid_up' : recommendedBid < r.currentBid ? 'bid_down' : null;
        }

        suggestions.push({
          entityKey: r.entityKey,
          entityType: r.entityType,
          entityName: r.entityName,
          diagnosisCode: r.diagnosisCode,
          currentBid: r.currentBid,
          recommendedBid,
          direction,
          eligible,
          reason: !eligible ? (eligibilityStr === 'insufficient_data' ? 'Données insuffisantes' : eligibilityStr === 'cooldown' ? 'En observation' : undefined) : undefined,
          cooldownActive: hasCooldown,
        });
      } else {
        errors.push({
          entityKey: dto.entities[index].entityKey,
          error: result.reason?.message || String(result.reason),
        });
      }
    });

    return {
      suggestions,
      errors,
    };
  }

  /**
   * POST /api/actions/batch-execute-direct
   * Exécute plusieurs actions directes séquentiellement avec délai entre chaque
   */
  @Post('batch-execute-direct')
  async batchExecuteDirectActions(@Body() dto: BatchExecuteDirectDto) {
    this.logger.log(
      `Batch execute ${dto.actions.length} actions in workspace ${dto.workspaceId}`,
    );

    const results = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < dto.actions.length; i++) {
      const action = dto.actions[i];

      try {
        const result = await this.executorService.executeDirectAction({
          workspaceId: dto.workspaceId,
          entityKey: action.entityKey,
          entityType: action.entityType,
          actionType: action.actionType,
          newBid: action.newBid,
          rationale: action.rationale,
          dryRun: dto.dryRun,
          lifecyclePhase: dto.lifecyclePhase,
        });

        results.push({
          entityKey: action.entityKey,
          success: result.success,
          actionId: result.actionId,
          error: result.error,
          beforeValue: result.beforeValue,
          afterValue: result.afterValue,
        });

        if (result.success) {
          succeeded++;
        } else {
          failed++;
        }
      } catch (error) {
        results.push({
          entityKey: action.entityKey,
          success: false,
          error: error?.message || String(error),
        });
        failed++;
      }

      // Add delay between executions to respect rate limits
      if (i < dto.actions.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return {
      total: dto.actions.length,
      succeeded,
      failed,
      results,
    };
  }
}
