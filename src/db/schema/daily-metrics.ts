import { pgTable, uuid, varchar, timestamp, integer, decimal, date, text, unique, index } from 'drizzle-orm/pg-core';
import { marketplaceProfiles } from './marketplace-profiles';

export const entityTypeEnum = ['campaign', 'ad_group', 'keyword', 'target', 'search_term'] as const;
export type EntityType = typeof entityTypeEnum[number];

export const dailyMetrics = pgTable('daily_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityKey: text('entity_key').notNull(),
  profileId: uuid('profile_id').notNull().references(() => marketplaceProfiles.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  marketplace: varchar('marketplace', { length: 10 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  impressions: integer('impressions').default(0),
  clicks: integer('clicks').default(0),
  spend: decimal('spend', { precision: 12, scale: 4 }).default('0'),
  sales: decimal('sales', { precision: 12, scale: 4 }).default('0'),
  orders: integer('orders').default(0),
  units: integer('units').default(0),
  attributionWindow: varchar('attribution_window', { length: 10 }).default('7d'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueEntityTypeKeyDate: unique().on(table.entityType, table.entityKey, table.date),
  idxMetricsEntity: index('idx_metrics_entity').on(table.entityType, table.entityKey),
  idxMetricsDate: index('idx_metrics_date').on(table.date),
  idxMetricsProfileDate: index('idx_metrics_profile_date').on(table.profileId, table.date),
}));

export type DailyMetric = typeof dailyMetrics.$inferSelect;
export type NewDailyMetric = typeof dailyMetrics.$inferInsert;
