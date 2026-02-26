import { pgTable, uuid, varchar, timestamp, jsonb, decimal, bigint, unique, index } from 'drizzle-orm/pg-core';
import { adGroups } from './ad-groups';

export const matchTypeEnum = ['exact', 'phrase', 'broad'] as const;
export type MatchType = typeof matchTypeEnum[number];

export const keywords = pgTable('keywords', {
  id: uuid('id').primaryKey().defaultRandom(),
  adGroupId: uuid('ad_group_id').notNull().references(() => adGroups.id, { onDelete: 'cascade' }),
  amazonKeywordId: bigint('amazon_keyword_id', { mode: 'number' }).notNull(),
  keywordText: varchar('keyword_text', { length: 500 }).notNull(),
  matchType: varchar('match_type', { length: 50 }).notNull(),
  state: varchar('state', { length: 50 }).notNull(),
  bid: decimal('bid', { precision: 10, scale: 4 }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  rawData: jsonb('raw_data'),
  // Bid cooldown tracking
  lastBidChangeAt: timestamp('last_bid_change_at', { withTimezone: true }),
  lastBidChangeType: varchar('last_bid_change_type', { length: 20 }),
  previousBid: decimal('previous_bid', { precision: 10, scale: 4 }),
  newBid: decimal('new_bid', { precision: 10, scale: 4 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueAdGroupKeyword: unique().on(table.adGroupId, table.amazonKeywordId),
  idxKeywordsAdGroup: index('idx_keywords_ad_group').on(table.adGroupId),
  idxKeywordsText: index('idx_keywords_text').on(table.keywordText),
  idxKeywordsState: index('idx_keywords_state').on(table.state),
  idxKeywordsLastBidChange: index('idx_keywords_last_bid_change').on(table.lastBidChangeAt),
}));

export type Keyword = typeof keywords.$inferSelect;
export type NewKeyword = typeof keywords.$inferInsert;
