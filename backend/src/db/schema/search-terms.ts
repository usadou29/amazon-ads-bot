import { pgTable, uuid, varchar, timestamp, bigint, unique, index } from 'drizzle-orm/pg-core';
import { marketplaceProfiles } from './marketplace-profiles';
import { campaigns } from './campaigns';
import { adGroups } from './ad-groups';
import { keywords } from './keywords';
import { productTargets } from './product-targets';

export const searchTermStatusEnum = ['new', 'reviewed', 'promoted', 'negated', 'ignored'] as const;
export type SearchTermStatus = typeof searchTermStatusEnum[number];

export const searchTermTargetingTypeEnum = ['keyword', 'target', 'auto'] as const;
export type SearchTermTargetingType = typeof searchTermTargetingTypeEnum[number];

export const searchTerms = pgTable('search_terms', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => marketplaceProfiles.id, { onDelete: 'cascade' }),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  adGroupId: uuid('ad_group_id').notNull().references(() => adGroups.id, { onDelete: 'cascade' }),
  keywordId: uuid('keyword_id').references(() => keywords.id, { onDelete: 'set null' }),
  productTargetId: uuid('product_target_id').references(() => productTargets.id, { onDelete: 'set null' }),
  amazonCampaignId: bigint('amazon_campaign_id', { mode: 'number' }),
  amazonAdGroupId: bigint('amazon_ad_group_id', { mode: 'number' }),
  amazonKeywordId: bigint('amazon_keyword_id', { mode: 'number' }),
  amazonTargetId: bigint('amazon_target_id', { mode: 'number' }),
  // Affichage
  query: varchar('query', { length: 500 }).notNull(),
  // IMPORTANT: query_norm et query_hash sont des colonnes GENERATED dans PostgreSQL
  // Drizzle les lit mais ne les écrit pas directement
  queryNorm: varchar('query_norm', { length: 500 }),
  queryHash: varchar('query_hash', { length: 32 }),
  matchType: varchar('match_type', { length: 50 }),
  targetingType: varchar('targeting_type', { length: 50 }),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
  status: varchar('status', { length: 50 }).default('new'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // Dédup par query_hash dans le même ad_group
  uniqueAdGroupQueryHash: unique().on(table.adGroupId, table.queryHash),
  idxSearchTermsStatus: index('idx_search_terms_status').on(table.status),
  idxSearchTermsCampaign: index('idx_search_terms_campaign').on(table.campaignId),
  idxSearchTermsQuery: index('idx_search_terms_query').on(table.query),
  idxSearchTermsQueryNorm: index('idx_search_terms_query_norm').on(table.queryNorm),
}));

export type SearchTerm = typeof searchTerms.$inferSelect;
export type NewSearchTerm = typeof searchTerms.$inferInsert;
