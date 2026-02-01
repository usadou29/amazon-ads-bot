import { pgTable, uuid, varchar, timestamp, bigint, index, check } from 'drizzle-orm/pg-core';
import { campaigns } from './campaigns';
import { adGroups } from './ad-groups';
import { sql } from 'drizzle-orm';

export const negativeMatchTypeEnum = ['negativeExact', 'negativePhrase'] as const;
export type NegativeMatchType = typeof negativeMatchTypeEnum[number];

export const negativeKeywords = pgTable('negative_keywords', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
  adGroupId: uuid('ad_group_id').references(() => adGroups.id, { onDelete: 'cascade' }),
  amazonNegativeKeywordId: bigint('amazon_negative_keyword_id', { mode: 'number' }).notNull(),
  keywordText: varchar('keyword_text', { length: 500 }).notNull(),
  matchType: varchar('match_type', { length: 50 }).notNull(),
  state: varchar('state', { length: 50 }).notNull().default('enabled'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  idxNegativesCampaign: index('idx_negatives_campaign').on(table.campaignId),
  idxNegativesAdGroup: index('idx_negatives_ad_group').on(table.adGroupId),
  // Note: CHECK constraint is handled in SQL migration
}));

export type NegativeKeyword = typeof negativeKeywords.$inferSelect;
export type NewNegativeKeyword = typeof negativeKeywords.$inferInsert;
