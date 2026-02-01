import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Param,
  Logger,
  BadRequestException,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  RulesService,
  EvaluateRulesOptions,
  EvaluateRulesResult,
  RULE_TYPES,
  APPLIES_TO,
  RuleType,
  AppliesTo,
} from './rules.service';
import { Rule, NewRule, RuleConditions, RuleAction } from '@/db/schema';

// ============================================
// DTOs
// ============================================

interface ListRulesQueryDto {
  workspaceId: string;
  activeOnly?: string;
  ruleType?: RuleType;
}

interface CreateRuleDto {
  workspaceId: string;
  name: string;
  description?: string;
  ruleType: RuleType;
  appliesTo: AppliesTo;
  conditions: RuleConditions;
  actions: RuleAction;
  mode?: 'recommend' | 'auto';
  priority?: number;
  maxDailyExecutions?: number;
  cooldownHours?: number;
  isActive?: boolean;
}

interface UpdateRuleDto {
  name?: string;
  description?: string;
  conditions?: RuleConditions;
  actions?: RuleAction;
  mode?: 'recommend' | 'auto';
  priority?: number;
  maxDailyExecutions?: number;
  cooldownHours?: number;
  isActive?: boolean;
}

interface EvaluateRulesDto {
  workspaceId: string;
  profileId?: string;
  entityType?: AppliesTo;
  entityKeys?: string[];
  periodDays?: number;
  dryRun?: boolean;
}

interface UpdateRecommendationStatusDto {
  status: 'approved' | 'rejected' | 'skipped';
  reviewedBy?: string;
}

// ============================================
// CONTROLLER
// ============================================

@Controller('api/rules')
export class RulesController {
  private readonly logger = new Logger(RulesController.name);

  constructor(private readonly rulesService: RulesService) {}

  /**
   * GET /api/rules
   * Liste les regles d'un workspace
   *
   * Query params:
   * - workspaceId: string (required)
   * - activeOnly?: boolean (default: true)
   * - ruleType?: string
   */
  @Get()
  async listRules(@Query() query: ListRulesQueryDto): Promise<{
    rules: Rule[];
    total: number;
  }> {
    if (!query.workspaceId) {
      throw new BadRequestException('workspaceId query parameter is required');
    }

    // Valider ruleType si fourni
    if (query.ruleType && !RULE_TYPES.includes(query.ruleType)) {
      throw new BadRequestException(
        `Invalid ruleType. Must be one of: ${RULE_TYPES.join(', ')}`,
      );
    }

    this.logger.debug(`Listing rules for workspace ${query.workspaceId}`);

    const activeOnly = query.activeOnly !== 'false';
    const rules = await this.rulesService.listRules(query.workspaceId, {
      activeOnly,
      ruleType: query.ruleType,
    });

    return {
      rules,
      total: rules.length,
    };
  }

  /**
   * GET /api/rules/:id
   * Recupere une regle par son ID
   */
  @Get(':id')
  async getRule(@Param('id') id: string): Promise<Rule> {
    const rule = await this.rulesService.getRuleById(id);

    if (!rule) {
      throw new NotFoundException(`Rule ${id} not found`);
    }

    return rule;
  }

  /**
   * POST /api/rules
   * Cree une nouvelle regle
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createRule(@Body() body: CreateRuleDto): Promise<{
    message: string;
    rule: Rule;
  }> {
    // Validations
    this.validateCreateRuleDto(body);

    this.logger.log(`Creating rule "${body.name}" for workspace ${body.workspaceId}`);

    const newRule: NewRule = {
      workspaceId: body.workspaceId,
      name: body.name,
      description: body.description,
      ruleType: body.ruleType,
      appliesTo: body.appliesTo,
      conditions: body.conditions,
      actions: body.actions,
      mode: body.mode || 'recommend',
      priority: body.priority || 100,
      maxDailyExecutions: body.maxDailyExecutions,
      cooldownHours: body.cooldownHours,
      isActive: body.isActive !== false,
    };

    const rule = await this.rulesService.createRule(newRule);

    return {
      message: 'Rule created successfully',
      rule,
    };
  }

  /**
   * PATCH /api/rules/:id
   * Met a jour une regle
   */
  @Patch(':id')
  async updateRule(
    @Param('id') id: string,
    @Body() body: UpdateRuleDto,
  ): Promise<{
    message: string;
    rule: Rule;
  }> {
    // Valider les conditions si fournies
    if (body.conditions) {
      this.validateConditions(body.conditions);
    }

    // Valider les actions si fournies
    if (body.actions) {
      this.validateActions(body.actions);
    }

    this.logger.log(`Updating rule ${id}`);

    const rule = await this.rulesService.updateRule(id, body);

    return {
      message: 'Rule updated successfully',
      rule,
    };
  }

  /**
   * PATCH /api/rules/:id/deactivate
   * Desactive une regle
   */
  @Patch(':id/deactivate')
  async deactivateRule(@Param('id') id: string): Promise<{
    message: string;
    rule: Rule;
  }> {
    this.logger.log(`Deactivating rule ${id}`);

    const rule = await this.rulesService.deactivateRule(id);

    return {
      message: 'Rule deactivated successfully',
      rule,
    };
  }

  /**
   * POST /api/rules/evaluate
   * Evalue les regles contre les metriques et cree des recommandations
   */
  @Post('evaluate')
  @HttpCode(HttpStatus.OK)
  async evaluateRules(@Body() body: EvaluateRulesDto): Promise<{
    message: string;
    result: EvaluateRulesResult;
  }> {
    if (!body.workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    // Valider entityType si fourni
    if (body.entityType && !APPLIES_TO.includes(body.entityType)) {
      throw new BadRequestException(
        `Invalid entityType. Must be one of: ${APPLIES_TO.join(', ')}`,
      );
    }

    // Valider periodDays
    if (body.periodDays !== undefined) {
      if (body.periodDays < 1 || body.periodDays > 90) {
        throw new BadRequestException('periodDays must be between 1 and 90');
      }
    }

    this.logger.log(
      `Evaluating rules for workspace ${body.workspaceId}` +
      (body.dryRun ? ' (dry run)' : ''),
    );

    const options: EvaluateRulesOptions = {
      workspaceId: body.workspaceId,
      profileId: body.profileId,
      entityType: body.entityType,
      entityKeys: body.entityKeys,
      periodDays: body.periodDays || 7,
      dryRun: body.dryRun || false,
    };

    const result = await this.rulesService.evaluateRules(options);

    const message = result.dryRun
      ? `Dry run complete: ${result.details.filter((d) => d.matched).length} matches found`
      : `Evaluation complete: ${result.recommendationsCreated} recommendations created`;

    return {
      message,
      result,
    };
  }

  /**
   * GET /api/rules/recommendations/pending
   * Liste les recommandations en attente
   */
  @Get('recommendations/pending')
  async getPendingRecommendations(
    @Query('workspaceId') workspaceId: string,
    @Query('limit') limit?: string,
  ): Promise<{
    recommendations: any[];
    total: number;
  }> {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId query parameter is required');
    }

    const limitNum = limit ? parseInt(limit, 10) : 50;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 200) {
      throw new BadRequestException('limit must be between 1 and 200');
    }

    const recommendations = await this.rulesService.getPendingRecommendations(
      workspaceId,
      limitNum,
    );

    return {
      recommendations,
      total: recommendations.length,
    };
  }

  /**
   * PATCH /api/rules/recommendations/:id/status
   * Met a jour le statut d'une recommandation
   */
  @Patch('recommendations/:id/status')
  async updateRecommendationStatus(
    @Param('id') id: string,
    @Body() body: UpdateRecommendationStatusDto,
  ): Promise<{
    message: string;
    recommendation: any;
  }> {
    const validStatuses = ['approved', 'rejected', 'skipped'];
    if (!body.status || !validStatuses.includes(body.status)) {
      throw new BadRequestException(
        `status is required and must be one of: ${validStatuses.join(', ')}`,
      );
    }

    this.logger.log(`Updating recommendation ${id} status to ${body.status}`);

    const recommendation = await this.rulesService.updateRecommendationStatus(
      id,
      body.status,
      body.reviewedBy,
    );

    return {
      message: `Recommendation ${body.status} successfully`,
      recommendation,
    };
  }

  /**
   * GET /api/rules/types
   * Liste les types de regles disponibles
   */
  @Get('meta/types')
  getRuleTypes(): {
    ruleTypes: typeof RULE_TYPES;
    appliesTo: typeof APPLIES_TO;
  } {
    return {
      ruleTypes: RULE_TYPES,
      appliesTo: APPLIES_TO,
    };
  }

  // ============================================
  // VALIDATION HELPERS
  // ============================================

  private validateCreateRuleDto(dto: CreateRuleDto): void {
    if (!dto.workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    if (!dto.name || dto.name.trim().length === 0) {
      throw new BadRequestException('name is required');
    }

    if (!dto.ruleType || !RULE_TYPES.includes(dto.ruleType)) {
      throw new BadRequestException(
        `ruleType is required and must be one of: ${RULE_TYPES.join(', ')}`,
      );
    }

    if (!dto.appliesTo || !APPLIES_TO.includes(dto.appliesTo)) {
      throw new BadRequestException(
        `appliesTo is required and must be one of: ${APPLIES_TO.join(', ')}`,
      );
    }

    if (!dto.conditions) {
      throw new BadRequestException('conditions is required');
    }

    if (!dto.actions) {
      throw new BadRequestException('actions is required');
    }

    this.validateConditions(dto.conditions);
    this.validateActions(dto.actions);
  }

  private validateConditions(conditions: RuleConditions): void {
    if (!conditions.operator || !['AND', 'OR'].includes(conditions.operator)) {
      throw new BadRequestException(
        'conditions.operator is required and must be AND or OR',
      );
    }

    if (!Array.isArray(conditions.conditions) || conditions.conditions.length === 0) {
      throw new BadRequestException(
        'conditions.conditions must be a non-empty array',
      );
    }

    const validOperators = ['>=', '>', '<=', '<', '=', '!='];
    const validMetrics = [
      'clicks', 'impressions', 'spend', 'sales', 'orders', 'units',
      'acos', 'roas', 'ctr', 'cpc', 'cvr', 'cpa',
    ];

    for (const condition of conditions.conditions) {
      if (!condition.metric) {
        throw new BadRequestException('Each condition must have a metric');
      }

      const normalizedMetric = condition.metric.toLowerCase().replace(/[_-]/g, '');
      const isValidMetric = validMetrics.some(
        (m) => m.toLowerCase() === normalizedMetric,
      );

      if (!isValidMetric) {
        throw new BadRequestException(
          `Invalid metric: ${condition.metric}. Valid metrics: ${validMetrics.join(', ')}`,
        );
      }

      if (!validOperators.includes(condition.operator)) {
        throw new BadRequestException(
          `Invalid operator: ${condition.operator}. Valid operators: ${validOperators.join(', ')}`,
        );
      }

      if (typeof condition.value !== 'number') {
        throw new BadRequestException('Each condition must have a numeric value');
      }
    }
  }

  private validateActions(actions: RuleAction): void {
    // Action type est optionnel car il peut etre derive du rule_type
    // Mais si fourni, on le valide
    if (actions.adjustment_type) {
      if (!['percentage', 'absolute'].includes(actions.adjustment_type)) {
        throw new BadRequestException(
          'actions.adjustment_type must be percentage or absolute',
        );
      }
    }

    if (actions.adjustment_value !== undefined) {
      if (typeof actions.adjustment_value !== 'number') {
        throw new BadRequestException('actions.adjustment_value must be a number');
      }
    }
  }
}
