import { pgTable, uuid, boolean, timestamp, text, unique } from 'drizzle-orm/pg-core';
import { books } from './books';
import { campaigns } from './campaigns';

export const campaignBookMapping = pgTable('campaign_book_mapping', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  isPrimary: boolean('is_primary').default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueBookCampaign: unique().on(table.bookId, table.campaignId),
}));

export type CampaignBookMapping = typeof campaignBookMapping.$inferSelect;
export type NewCampaignBookMapping = typeof campaignBookMapping.$inferInsert;
