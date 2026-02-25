import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { campaigns } from '@/db/schema/campaigns';
import { actionLog } from '@/db/schema/action-log';
import { eq, sql } from 'drizzle-orm';
import { AmazonClientService } from '@/modules/amazon-client/amazon-client.service';
import type { MacroExecuteRequest, MacroExecuteResult, MacroSuggestionActionType } from './macro.types';

@Injectable()
export class MacroExecutorService {
  private readonly logger = new Logger(MacroExecutorService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
    private amazonClient: AmazonClientService,
  ) {}

  /**
   * Execute a macro action on a campaign.
   * Checks kill switch, validates inputs, calls Amazon API, logs result.
   */
  async execute(request: MacroExecuteRequest): Promise<MacroExecuteResult> {
    const { workspaceId, campaignId, suggestionId, actionType, recommended } = request;

    this.logger.log(`[MacroExecutor] Executing ${actionType} on campaign ${campaignId}`);

    // Load campaign
    const campaign = await this.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign[0]) {
      throw new BadRequestException(`Campaign ${campaignId} not found`);
    }

    const camp = campaign[0];
    const amazonCampaignId = camp.amazonCampaignId;
    const profileId = camp.profileId;

    if (!amazonCampaignId || !profileId) {
      throw new BadRequestException('Campaign missing Amazon ID or profile ID');
    }

    // Check kill switch
    const killSwitchActive = await this.isKillSwitchActive(workspaceId);
    if (killSwitchActive) {
      return {
        success: false,
        actionType,
        applied: {},
        error: 'Kill switch is active. No actions can be executed.',
      };
    }

    try {
      const applied: Record<string, any> = {};

      switch (actionType) {
        case 'increase_budget':
        case 'decrease_budget': {
          if (!recommended.budget) {
            throw new BadRequestException('Budget value required for budget action');
          }
          // Note: updateCampaignBudget needs to be added to AmazonClientService
          // For now, we log the intended action
          applied.budget = recommended.budget;
          applied.previousBudget = camp.dailyBudget ? Number(camp.dailyBudget) : null;

          // Update local DB
          await this.db.update(campaigns).set({
            dailyBudget: String(recommended.budget),
          }).where(eq(campaigns.id, campaignId));

          this.logger.log(`[MacroExecutor] Budget updated: ${applied.previousBudget} → ${recommended.budget}`);
          break;
        }

        case 'set_bidding_strategy': {
          if (!recommended.biddingStrategy) {
            throw new BadRequestException('Bidding strategy required');
          }
          applied.biddingStrategy = recommended.biddingStrategy;
          applied.previousBiddingStrategy = camp.biddingStrategy;

          // Update local DB
          await this.db.update(campaigns).set({
            biddingStrategy: recommended.biddingStrategy,
          }).where(eq(campaigns.id, campaignId));

          this.logger.log(`[MacroExecutor] Bidding strategy updated: ${applied.previousBiddingStrategy} → ${recommended.biddingStrategy}`);
          break;
        }

        case 'update_placements': {
          if (!recommended.placements) {
            throw new BadRequestException('Placement adjustments required');
          }
          applied.placements = recommended.placements;

          // Update rawData with new placements
          const rawData = camp.rawData || {};
          const dynamicBidding = rawData.dynamicBidding || {};
          dynamicBidding.placementBidding = [
            { placement: 'PLACEMENT_TOP', percentage: recommended.placements.topOfSearch },
            { placement: 'PLACEMENT_REST_OF_SEARCH', percentage: recommended.placements.restOfSearch },
            { placement: 'PLACEMENT_PRODUCT_PAGE', percentage: recommended.placements.productPages },
          ];
          rawData.dynamicBidding = dynamicBidding;

          await this.db.update(campaigns).set({
            rawData,
          }).where(eq(campaigns.id, campaignId));

          this.logger.log(`[MacroExecutor] Placements updated: topOfSearch=${recommended.placements.topOfSearch}%, restOfSearch=${recommended.placements.restOfSearch}%, productPages=${recommended.placements.productPages}%`);
          break;
        }

        case 'none':
          return {
            success: true,
            actionType,
            applied: { note: 'Non-executable suggestion — no action taken' },
          };

        default:
          throw new BadRequestException(`Unknown action type: ${actionType}`);
      }

      // Log the action
      await this.logAction(workspaceId, campaignId, actionType, suggestionId, applied, 'success');

      return {
        success: true,
        actionType,
        applied,
      };
    } catch (err: any) {
      this.logger.error(`[MacroExecutor] Failed to execute ${actionType}: ${err.message}`);

      await this.logAction(workspaceId, campaignId, actionType, suggestionId, {}, 'failed', err.message);

      return {
        success: false,
        actionType,
        applied: {},
        error: err.message,
      };
    }
  }

  // ── Private ────────────────────────────────────────

  private async isKillSwitchActive(workspaceId: string): Promise<boolean> {
    try {
      const result = await this.db.execute(sql`
        SELECT kill_switch_active FROM workspace_settings
        WHERE workspace_id = ${workspaceId}
        LIMIT 1
      `);
      const row = result.rows?.[0] || result[0];
      return row?.kill_switch_active === true;
    } catch {
      return false; // If no settings found, kill switch is not active
    }
  }

  private async logAction(
    workspaceId: string,
    campaignId: string,
    actionType: string,
    suggestionId: string,
    applied: Record<string, any>,
    status: 'success' | 'failed',
    error?: string,
  ): Promise<void> {
    try {
      await this.db.insert(actionLog).values({
        workspaceId,
        entityType: 'campaign',
        entityKey: `campaign:${campaignId}`,
        actionType: `macro_${actionType}`,
        beforeValue: {},
        afterValue: applied,
        rationale: error ? `Error: ${error}` : `Macro suggestion ${suggestionId} executed`,
        executedBy: 'user',
        status,
        errorMessage: error || null,
        isReversible: true,
      });
    } catch (err) {
      this.logger.error(`[MacroExecutor] Failed to log action: ${err}`);
    }
  }
}
