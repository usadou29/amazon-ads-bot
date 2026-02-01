import { pgTable, uuid, varchar, timestamp, jsonb, decimal, bigint, unique, index } from 'drizzle-orm/pg-core';
import { campaigns } from './campaigns';

export const adGroups = pgTable('ad_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  amazonAdGroupId: bigint('amazon_ad_group_id', { mode: 'number' }).notNull(),
  name: varchar('name', { length: 500 }).notNull(),
  state: varchar('state', { length: 50 }).notNull(),
  defaultBid: decimal('default_bid', { precision: 10, scale: 4 }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueCampaignAdGroup: unique().on(table.campaignId, table.amazonAdGroupId),
  idxAdGroupsCampaign: index('idx_ad_groups_campaign').on(table.campaignId),
}));

export type AdGroup = typeof adGroups.$inferSelect;
export type NewAdGroup = typeof adGroups.$inferInsert;
