import { pgTable, uuid, varchar, timestamp, jsonb, decimal, bigint, date, unique, index } from 'drizzle-orm/pg-core';
import { marketplaceProfiles } from './marketplace-profiles';
import { portfolios } from './portfolios';

export const campaignTypeEnum = ['sponsoredProducts', 'sponsoredBrands', 'sponsoredDisplay'] as const;
export type CampaignType = typeof campaignTypeEnum[number];

export const targetingTypeEnum = ['manual', 'auto'] as const;
export type TargetingType = typeof targetingTypeEnum[number];

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => marketplaceProfiles.id, { onDelete: 'cascade' }),
  portfolioId: uuid('portfolio_id').references(() => portfolios.id, { onDelete: 'set null' }),
  amazonCampaignId: bigint('amazon_campaign_id', { mode: 'number' }).notNull(),
  name: varchar('name', { length: 500 }).notNull(),
  campaignType: varchar('campaign_type', { length: 50 }).notNull().default('sponsoredProducts'),
  state: varchar('state', { length: 50 }).notNull(),
  targetingType: varchar('targeting_type', { length: 50 }),
  budgetType: varchar('budget_type', { length: 50 }).default('daily'),
  dailyBudget: decimal('daily_budget', { precision: 10, scale: 2 }),
  biddingStrategy: varchar('bidding_strategy', { length: 50 }),
  startDate: date('start_date'),
  endDate: date('end_date'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueProfileCampaign: unique().on(table.profileId, table.amazonCampaignId),
  idxCampaignsProfile: index('idx_campaigns_profile').on(table.profileId),
  idxCampaignsState: index('idx_campaigns_state').on(table.state),
}));

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
