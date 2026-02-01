import { pgTable, uuid, varchar, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { adAccounts } from './ad-accounts';
import { marketplaceProfiles } from './marketplace-profiles';

export const syncStatusEnum = ['running', 'success', 'partial', 'failed'] as const;
export type SyncStatus = typeof syncStatusEnum[number];

export const syncLogs = pgTable('sync_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  adAccountId: uuid('ad_account_id').notNull().references(() => adAccounts.id, { onDelete: 'cascade' }),
  profileId: uuid('profile_id').references(() => marketplaceProfiles.id, { onDelete: 'cascade' }),
  jobName: varchar('job_name', { length: 100 }).notNull(),
  jobType: varchar('job_type', { length: 50 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  durationSeconds: integer('duration_seconds'),
  status: varchar('status', { length: 50 }).notNull(),
  recordsFetched: integer('records_fetched').default(0),
  recordsCreated: integer('records_created').default(0),
  recordsUpdated: integer('records_updated').default(0),
  recordsFailed: integer('records_failed').default(0),
  details: jsonb('details'),
  errors: jsonb('errors'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  idxSyncAccount: index('idx_sync_account').on(table.adAccountId),
  idxSyncDate: index('idx_sync_date').on(table.startedAt),
}));

export type SyncLog = typeof syncLogs.$inferSelect;
export type NewSyncLog = typeof syncLogs.$inferInsert;
