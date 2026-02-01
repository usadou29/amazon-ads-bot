import { pgTable, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const systemConfig = pgTable('system_config', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export type SystemConfigEntry = typeof systemConfig.$inferSelect;
export type NewSystemConfigEntry = typeof systemConfig.$inferInsert;

// Types pour les configurations
export interface KillSwitchConfig {
  enabled: boolean;
  reason: string | null;
  enabled_at: string | null;
  enabled_by: string | null;
}

export interface GlobalSettings {
  dry_run: boolean;
  max_actions_per_day: number;
}
