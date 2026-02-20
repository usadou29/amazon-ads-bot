import { pgTable, uuid, varchar, timestamp, text } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const adAccountStatusEnum = ['active', 'paused', 'error', 'revoked'] as const;
export type AdAccountStatus = typeof adAccountStatusEnum[number];

export const adAccounts = pgTable('ad_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  amazonAccountId: varchar('amazon_account_id', { length: 100 }),
  accountName: varchar('account_name', { length: 255 }),
  status: varchar('status', { length: 50 }).default('active'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export type AdAccount = typeof adAccounts.$inferSelect;
export type NewAdAccount = typeof adAccounts.$inferInsert;
