import { pgTable, uuid, varchar, timestamp, jsonb, decimal, text, index, integer, boolean } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';
import { rules } from './rules';

export const recommendationStatusEnum = ['pending', 'approved', 'rejected', 'executed', 'expired', 'skipped'] as const;
export type RecommendationStatus = typeof recommendationStatusEnum[number];

export const riskLevelEnum = ['low', 'medium', 'high'] as const;
export type RiskLevel = typeof riskLevelEnum[number];

export const consentLevelEnum = ['none', 'basic', 'reinforced'] as const;
export type ConsentLevel = typeof consentLevelEnum[number];

export const recommendations = pgTable('recommendations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  ruleId: uuid('rule_id').references(() => rules.id, { onDelete: 'set null' }),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityKey: text('entity_key').notNull(),
  actionType: varchar('action_type', { length: 50 }).notNull(),
  suggestedAction: jsonb('suggested_action').notNull(),
  contextData: jsonb('context_data'),
  confidenceScore: decimal('confidence_score', { precision: 5, scale: 4 }),
  ruleSnapshot: jsonb('rule_snapshot'),
  status: varchar('status', { length: 50 }).default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: varchar('reviewed_by', { length: 50 }),
  actionId: uuid('action_id'),
  // ── Strategy Engine fields ──
  strategyScore: integer('strategy_score'),
  strategyLabel: varchar('strategy_label', { length: 255 }),
  riskLevel: varchar('risk_level', { length: 20 }),
  recommendedForLifecycle: boolean('recommended_for_lifecycle').default(false),
  requiresConsent: boolean('requires_consent').default(false),
  consentLevel: varchar('consent_level', { length: 20 }).default('none'),
}, (table) => ({
  idxRecoStatus: index('idx_reco_status').on(table.status, table.workspaceId),
  idxRecoEntity: index('idx_reco_entity').on(table.entityType, table.entityKey),
  idxRecoPending: index('idx_reco_pending').on(table.status, table.createdAt),
}));

export type Recommendation = typeof recommendations.$inferSelect;
export type NewRecommendation = typeof recommendations.$inferInsert;
