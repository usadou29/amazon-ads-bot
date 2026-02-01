import { pgTable, uuid, varchar, timestamp, jsonb, unique } from 'drizzle-orm/pg-core';
import { users } from './users';

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  settings: jsonb('settings').default({
    default_acos_target: 40,
    notification_channels: ['telegram'],
    timezone: 'Europe/Paris',
    auto_mode_enabled: false,
    dry_run: true,
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueUserName: unique().on(table.userId, table.name),
}));

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

export interface WorkspaceSettings {
  default_acos_target: number;
  notification_channels: string[];
  timezone: string;
  auto_mode_enabled: boolean;
  dry_run: boolean;
}
