import { pgTable, uuid, varchar, timestamp, jsonb, decimal, bigint, unique, index } from 'drizzle-orm/pg-core';
import { adGroups } from './ad-groups';

export const productTargets = pgTable('product_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  adGroupId: uuid('ad_group_id').notNull().references(() => adGroups.id, { onDelete: 'cascade' }),
  amazonTargetId: bigint('amazon_target_id', { mode: 'number' }).notNull(),
  expressionType: varchar('expression_type', { length: 50 }).notNull(),
  expression: jsonb('expression').notNull(),
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
  uniqueAdGroupTarget: unique().on(table.adGroupId, table.amazonTargetId),
  idxProductTargetsLastBidChange: index('idx_product_targets_last_bid_change').on(table.lastBidChangeAt),
}));

export type ProductTarget = typeof productTargets.$inferSelect;
export type NewProductTarget = typeof productTargets.$inferInsert;
