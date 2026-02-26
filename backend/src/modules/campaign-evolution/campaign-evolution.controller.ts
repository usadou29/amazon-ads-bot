import { Controller, Post, Get, Param, Query, Body, BadRequestException, Logger } from '@nestjs/common';
import { CampaignEvolutionService } from './campaign-evolution.service';
import { CreateFromPlanService, type CreateFromPlanDto, type CreateFromPlanResult } from './create-from-plan.service';
import type { CampaignEvolutionResult } from './campaign-evolution.types';

@Controller('api')
export class CampaignEvolutionController {
  private readonly logger = new Logger(CampaignEvolutionController.name);

  constructor(
    private readonly evolutionService: CampaignEvolutionService,
    private readonly createFromPlanService: CreateFromPlanService,
  ) {}

  /**
   * POST /api/campaign-evolution/analyze/:bookId?workspaceId=xxx
   * Analyse complète du portefeuille publicitaire d'un livre
   */
  @Post('campaign-evolution/analyze/:bookId')
  async analyzeBook(
    @Param('bookId') bookId: string,
    @Query('workspaceId') workspaceId: string,
  ): Promise<CampaignEvolutionResult> {
    if (!bookId || !workspaceId) {
      throw new BadRequestException('bookId and workspaceId are required');
    }

    this.logger.log(`Analyzing evolution for book ${bookId}, workspace ${workspaceId}`);
    return this.evolutionService.analyzeBookEvolution(bookId, workspaceId);
  }

  /**
   * GET /api/campaign-evolution/maturity-score/:bookId?workspaceId=xxx
   * Retourne uniquement le maturity score (endpoint léger)
   */
  @Get('campaign-evolution/maturity-score/:bookId')
  async getMaturityScore(
    @Param('bookId') bookId: string,
    @Query('workspaceId') workspaceId: string,
  ): Promise<{ maturityScore: number; breakdown: Record<string, number> }> {
    if (!bookId || !workspaceId) {
      throw new BadRequestException('bookId and workspaceId are required');
    }

    const result = await this.evolutionService.analyzeBookEvolution(bookId, workspaceId);
    return {
      maturityScore: result.maturityScore,
      breakdown: {
        structure: result.maturityBreakdown.structure,
        winnersExploited: result.maturityBreakdown.winnersExploited,
        diversification: result.maturityBreakdown.diversification,
        stability: result.maturityBreakdown.stability,
      },
    };
  }

  /**
   * POST /api/campaigns/create-from-plan
   * Crée une campagne Amazon Ads à partir d'une recommandation du plan d'évolution
   * Idempotent : ne recrée pas si le même fingerprint existe déjà
   */
  @Post('campaigns/create-from-plan')
  async createFromPlan(@Body() dto: CreateFromPlanDto): Promise<CreateFromPlanResult> {
    this.logger.log(`Creating campaign from plan: ${dto.planActionType} for book ${dto.bookId}`);
    return this.createFromPlanService.createCampaignFromPlan(dto);
  }
}
