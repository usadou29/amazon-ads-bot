import { pgTable, uuid, varchar, timestamp, jsonb, decimal, bigint, unique } from 'drizzle-orm/pg-core';
import { marketplaceProfiles } from './marketplace-profiles';

export const stateEnum = ['enabled', 'paused', 'archived'] as const;
export type EntityState = typeof stateEnum[number];

export const portfolios = pgTable('portfolios', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => marketplaceProfiles.id, { onDelete: 'cascade' }),
  amazonPortfolioId: bigint('amazon_portfolio_id', { mode: 'number' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  state: varchar('state', { length: 50 }),
  budgetAmount: decimal('budget_amount', { precision: 10, scale: 2 }),
  budgetCurrency: varchar('budget_currency', { length: 3 }),
  budgetPolicy: varchar('budget_policy', { length: 50 }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueProfilePortfolio: unique().on(table.profileId, table.amazonPortfolioId),
}));

export type Portfolio = typeof portfolios.$inferSelect;
export type NewPortfolio = typeof portfolios.$inferInsert;
