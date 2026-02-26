import { pgTable, uuid, varchar, timestamp, jsonb, decimal, date, unique, text, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const books = pgTable('books', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  asin: varchar('asin', { length: 20 }).notNull(),
  marketplace: varchar('marketplace', { length: 10 }).notNull(),
  title: varchar('title', { length: 500 }),
  author: varchar('author', { length: 255 }),
  kdpId: varchar('kdp_id', { length: 100 }),
  coverImageUrl: text('cover_image_url'),
  publicationDate: date('publication_date'),
  categories: jsonb('categories').default([]),
  tags: jsonb('tags').default([]),
  acosTarget: decimal('acos_target', { precision: 5, scale: 2 }),
  royaltyRate: decimal('royalty_rate', { precision: 5, scale: 2 }),
  salePrice: decimal('sale_price', { precision: 10, scale: 2 }),
  royaltyPerUnit: decimal('royalty_per_unit', { precision: 10, scale: 2 }),
  dailyBudgetTarget: decimal('daily_budget_target', { precision: 10, scale: 2 }),
  lifecyclePhaseOverride: varchar('lifecycle_phase_override', { length: 20 }),
  // Lifecycle tracking fields
  lifecyclePhase: varchar('lifecycle_phase', { length: 20 }),
  lifecycleSource: varchar('lifecycle_source', { length: 10 }).default('auto'),
  lifecycleChangedAt: timestamp('lifecycle_changed_at', { withTimezone: true }),
  lifecyclePreviousPhase: varchar('lifecycle_previous_phase', { length: 20 }),
  lifecyclePendingPhase: varchar('lifecycle_pending_phase', { length: 20 }),
  lifecyclePendingSince: timestamp('lifecycle_pending_since', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueWorkspaceAsinMarketplace: unique().on(table.workspaceId, table.asin, table.marketplace),
  idxBooksLifecycleSource: index('idx_books_lifecycle_source').on(table.lifecycleSource),
}));

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;

export const lifecyclePhaseEnum = ['launch', 'scale', 'evergreen', 'relaunch'] as const;
export type LifecyclePhase = typeof lifecyclePhaseEnum[number];

export type LifecycleSource = 'auto' | 'manual';
