import { pgTable, uuid, varchar, timestamp, jsonb, decimal, date, unique } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const books = pgTable('books', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  asin: varchar('asin', { length: 20 }).notNull(),
  marketplace: varchar('marketplace', { length: 10 }).notNull(),
  title: varchar('title', { length: 500 }),
  author: varchar('author', { length: 255 }),
  kdpId: varchar('kdp_id', { length: 100 }),
  publicationDate: date('publication_date'),
  categories: jsonb('categories').default([]),
  tags: jsonb('tags').default([]),
  acosTarget: decimal('acos_target', { precision: 5, scale: 2 }),
  royaltyRate: decimal('royalty_rate', { precision: 5, scale: 2 }),
  salePrice: decimal('sale_price', { precision: 10, scale: 2 }),
  royaltyPerUnit: decimal('royalty_per_unit', { precision: 10, scale: 2 }),
  dailyBudgetTarget: decimal('daily_budget_target', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueWorkspaceAsinMarketplace: unique().on(table.workspaceId, table.asin, table.marketplace),
}));

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
