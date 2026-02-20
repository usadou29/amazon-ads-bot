import { pgTable, uuid, varchar, timestamp, jsonb, decimal, bigint, unique } from 'drizzle-orm/pg-core';
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueAdGroupTarget: unique().on(table.adGroupId, table.amazonTargetId),
}));

export type ProductTarget = typeof productTargets.$inferSelect;
export type NewProductTarget = typeof productTargets.$inferInsert;
