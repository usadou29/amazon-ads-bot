import { pgTable, uuid, varchar, timestamp, integer, text, date, unique, index } from 'drizzle-orm/pg-core';
import { marketplaceProfiles } from './marketplace-profiles';
import { workspaces } from './workspaces';

export const reportTypeEnum = ['campaigns', 'ad_groups', 'keywords', 'targets', 'search_terms', 'keywords_impression_share', 'targets_impression_share'] as const;
export type ReportType = typeof reportTypeEnum[number];

export const reportStatusEnum = ['pending', 'requested', 'processing', 'ready', 'downloaded', 'ingested', 'failed'] as const;
export type ReportStatus = typeof reportStatusEnum[number];

export const reportJobs = pgTable('report_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  profileId: uuid('profile_id').notNull().references(() => marketplaceProfiles.id, { onDelete: 'cascade' }),
  reportType: varchar('report_type', { length: 50 }).notNull(),
  amazonReportId: varchar('amazon_report_id', { length: 200 }),
  dateFrom: date('date_from').notNull(),
  dateTo: date('date_to').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  requestedAt: timestamp('requested_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }),
  downloadUrl: text('download_url'),
  recordsProcessed: integer('records_processed').default(0),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueProfileReportDateRange: unique().on(table.profileId, table.reportType, table.dateFrom, table.dateTo),
  idxReportJobsStatus: index('idx_report_jobs_status').on(table.status),
}));

export type ReportJob = typeof reportJobs.$inferSelect;
export type NewReportJob = typeof reportJobs.$inferInsert;
