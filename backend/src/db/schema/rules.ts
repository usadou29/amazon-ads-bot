import { pgTable, uuid, varchar, timestamp, jsonb, integer, boolean, text, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const ruleTypeEnum = [
  'bid_adjustment',
  'pause_keyword',
  'enable_keyword',
  'harvest_search_term',
  'add_negative',
  'budget_alert',
  'acos_alert',
  'low_impressions',
  'performance_trend',
  'acos_above_royalty',
] as const;
export type RuleType = typeof ruleTypeEnum[number];

export const appliesToEnum = ['campaign', 'ad_group', 'keyword', 'target', 'search_term'] as const;
export type AppliesTo = typeof appliesToEnum[number];

export const ruleModeEnum = ['recommend', 'auto'] as const;
export type RuleMode = typeof ruleModeEnum[number];

export const rules = pgTable('rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  ruleType: varchar('rule_type', { length: 50 }).notNull(),
  appliesTo: varchar('applies_to', { length: 50 }).notNull(),
  conditions: jsonb('conditions').notNull(),
  actions: jsonb('actions').notNull(),
  mode: varchar('mode', { length: 50 }).default('recommend'),
  priority: integer('priority').default(100),
  maxDailyExecutions: integer('max_daily_executions').default(10),
  cooldownHours: integer('cooldown_hours').default(48),
  isActive: boolean('is_active').default(true),
  version: integer('version').default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  idxRulesWorkspace: index('idx_rules_workspace').on(table.workspaceId),
  idxRulesActive: index('idx_rules_active').on(table.isActive, table.priority),
}));

export type Rule = typeof rules.$inferSelect;
export type NewRule = typeof rules.$inferInsert;

// Types pour les conditions et actions JSON
export interface RuleCondition {
  metric: string;
  operator: '>=' | '>' | '<=' | '<' | '=' | '!=';
  value: number;
  period_days: number;
}

export interface RuleConditions {
  operator: 'AND' | 'OR';
  conditions: RuleCondition[];
}

export interface RuleAction {
  action_type: string;
  adjustment_type?: 'percentage' | 'absolute';
  adjustment_value?: number;
  min_value?: number | null;
  max_value?: number | null;
  match_type?: string;
  bid_strategy?: string;
  level?: string;
  severity?: string;
}
