import { pgTable, uuid, varchar, timestamp, jsonb, bigint, text, boolean, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { recommendations } from './recommendations';
import { rules } from './rules';

export const executedByEnum = ['system', 'user', 'manual'] as const;
export type ExecutedBy = typeof executedByEnum[number];

export const actionStatusEnum = ['pending', 'success', 'failed', 'rolled_back', 'simulated'] as const;
export type ActionStatus = typeof actionStatusEnum[number];

export const actionLog = pgTable('action_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  recommendationId: uuid('recommendation_id').references(() => recommendations.id),
  ruleId: uuid('rule_id').references(() => rules.id),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityKey: text('entity_key').notNull(),
  amazonEntityId: bigint('amazon_entity_id', { mode: 'number' }),
  actionType: varchar('action_type', { length: 50 }).notNull(),
  beforeValue: jsonb('before_value'),
  afterValue: jsonb('after_value'),
  rationale: text('rationale').notNull(),
  executedBy: varchar('executed_by', { length: 50 }).notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).defaultNow(),
  status: varchar('status', { length: 50 }).notNull(),
  apiRequest: jsonb('api_request'),
  apiResponse: jsonb('api_response'),
  errorMessage: text('error_message'),
  isReversible: boolean('is_reversible').default(false),
  rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
  rollbackActionId: uuid('rollback_action_id'),
  dryRun: boolean('dry_run').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  idxActionWorkspace: index('idx_action_workspace').on(table.workspaceId),
  idxActionEntity: index('idx_action_entity').on(table.entityType, table.entityKey),
  idxActionDate: index('idx_action_date').on(table.executedAt),
  idxActionStatus: index('idx_action_status').on(table.status),
}));

export type ActionLogEntry = typeof actionLog.$inferSelect;
export type NewActionLogEntry = typeof actionLog.$inferInsert;
