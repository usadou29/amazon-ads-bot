import { Controller, Post, Get, Param, Query, Body, BadRequestException, Logger } from '@nestjs/common';
import { CampaignEvolutionService } from './campaign-evolution.service';
import {
  CreateFromPlanService,
  type CreateFromPlanDto,
  type CreateFromPlanResult,
  type BatchCreateFromPlanDto,
  type BatchCreateFromPlanResult,
} from './create-from-plan.service';
import type {
  CampaignEvolutionResult,
  PauseBatchDto,
  PauseBatchResult,
  CreationPlanRequestDto,
  CreationPlanResponse,
  PauseAllForBookDto,
  PauseAllForBookResult,
} from './campaign-evolution.types';

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

  /**
   * POST /api/campaigns/create-batch-from-plan
   * Crée N campagnes d'un CreationPlan en séquence.
   * Chaque campagne peut être overridden (budget, biddingStrategy).
   * Idempotent par planId + fingerprint.
   */
  @Post('campaigns/create-batch-from-plan')
  async createBatchFromPlan(
    @Body() dto: BatchCreateFromPlanDto,
  ): Promise<BatchCreateFromPlanResult> {
    this.logger.log(`Batch creating ${dto.campaigns.length} campaigns from plan ${dto.planId} for book ${dto.bookId}`);
    return this.createFromPlanService.createBatchFromPlan(dto);
  }

  /**
   * POST /api/campaigns/pause-batch
   * Met en pause N campagnes Amazon Ads en séquence.
   * Utilisé par le flux "Repartir proprement" quand pauseStrategy est présent.
   */
  @Post('campaigns/pause-batch')
  async pauseBatch(@Body() dto: PauseBatchDto): Promise<PauseBatchResult> {
    if (!dto.workspaceId || !dto.bookId || !dto.campaignIds?.length) {
      throw new BadRequestException('workspaceId, bookId, and campaignIds are required');
    }
    if (dto.campaignIds.length > 20) {
      throw new BadRequestException('Maximum 20 campaigns per batch');
    }
    this.logger.log(`Pause batch: ${dto.campaignIds.length} campaigns for book ${dto.bookId}`);
    return this.createFromPlanService.pauseBatch(dto);
  }

  /**
   * POST /api/campaign-evolution/creation-plan
   * Génère un plan de création on-demand, recalculable avec lifecycle override.
   * Utilisé par le RebuildWizard.
   */
  @Post('campaign-evolution/creation-plan')
  async getCreationPlan(@Body() dto: CreationPlanRequestDto): Promise<CreationPlanResponse> {
    if (!dto.bookId || !dto.workspaceId) {
      throw new BadRequestException('bookId and workspaceId are required');
    }
    this.logger.log(`Creation plan requested for book ${dto.bookId} (override=${dto.lifecyclePhaseOverride}, forceRebuild=${dto.forceRebuild}, mode=${dto.mode})`);
    return this.evolutionService.generateCreationPlan(
      dto.bookId,
      dto.workspaceId,
      dto.lifecyclePhaseOverride,
      dto.forceRebuild,
      dto.mode,
    );
  }

  /**
   * POST /api/campaigns/pause-all-for-book
   * Met en pause TOUTES les campagnes actives d'un livre.
   * Utilisé par le RebuildWizard en mode "repartir proprement".
   */
  @Post('campaigns/pause-all-for-book')
  async pauseAllForBook(@Body() dto: PauseAllForBookDto): Promise<PauseAllForBookResult> {
    if (!dto.workspaceId || !dto.bookId) {
      throw new BadRequestException('workspaceId and bookId are required');
    }
    this.logger.log(`Pause ALL campaigns for book ${dto.bookId}`);
    return this.createFromPlanService.pauseAllForBook(dto.workspaceId, dto.bookId, dto.reason || 'Rebuild propre');
  }
}
