import { pgTable, uuid, varchar, timestamp, boolean, bigint, unique, index } from 'drizzle-orm/pg-core';
import { adAccounts } from './ad-accounts';

export const marketplaceEnum = ['FR', 'DE', 'US', 'UK', 'ES', 'IT', 'CA', 'AU'] as const;
export type Marketplace = typeof marketplaceEnum[number];

export const currencyEnum = ['EUR', 'USD', 'GBP', 'CAD', 'AUD'] as const;
export type Currency = typeof currencyEnum[number];

export const marketplaceProfiles = pgTable('marketplace_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  adAccountId: uuid('ad_account_id').notNull().references(() => adAccounts.id, { onDelete: 'cascade' }),
  profileId: bigint('profile_id', { mode: 'number' }).notNull(),
  marketplace: varchar('marketplace', { length: 10 }).notNull(),
  marketplaceId: varchar('marketplace_id', { length: 50 }),
  currency: varchar('currency', { length: 3 }).notNull(),
  isActive: boolean('is_active').default(true),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSearchTermsSyncAt: timestamp('last_search_terms_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueAccountProfile: unique().on(table.adAccountId, table.profileId),
  idxProfilesMarketplace: index('idx_profiles_marketplace').on(table.adAccountId, table.marketplace),
}));

export type MarketplaceProfile = typeof marketplaceProfiles.$inferSelect;
export type NewMarketplaceProfile = typeof marketplaceProfiles.$inferInsert;
