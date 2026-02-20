import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@/db/database.module';
import { campaigns, marketplaceProfiles, adAccounts } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private db: any,
  ) {}

  /**
   * Liste toutes les campagnes d'un workspace
   */
  async findAll(workspaceId: string): Promise<any[]> {
    const query = sql`
      SELECT
        c.id,
        c.name,
        c.campaign_type AS "campaignType",
        c.state,
        c.daily_budget AS "dailyBudget",
        c.targeting_type AS "targetingType",
        c.bidding_strategy AS "biddingStrategy",
        c.start_date AS "startDate",
        c.end_date AS "endDate",
        mp.marketplace,
        mp.id AS "profileId"
      FROM campaigns c
      INNER JOIN marketplace_profiles mp ON c.profile_id = mp.id
      INNER JOIN ad_accounts aa ON mp.ad_account_id = aa.id
      WHERE aa.workspace_id = ${workspaceId}
      ORDER BY c.name
    `;

    const result = await this.db.execute(query);
    return result.rows || result;
  }

  /**
   * Compte les campagnes d'un workspace
   */
  async count(workspaceId: string): Promise<{ count: number }> {
    const query = sql`
      SELECT COUNT(*) AS count
      FROM campaigns c
      INNER JOIN marketplace_profiles mp ON c.profile_id = mp.id
      INNER JOIN ad_accounts aa ON mp.ad_account_id = aa.id
      WHERE aa.workspace_id = ${workspaceId}
    `;

    const result = await this.db.execute(query);
    const rows = result.rows || result;
    return { count: Number(rows[0]?.count || 0) };
  }
}
