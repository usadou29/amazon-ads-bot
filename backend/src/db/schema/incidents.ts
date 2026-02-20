import { pgTable, uuid, varchar, timestamp, jsonb, boolean, text, index } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const severityEnum = ['info', 'warning', 'error', 'critical'] as const;
export type Severity = typeof severityEnum[number];

export const incidentStatusEnum = ['open', 'acknowledged', 'resolved', 'ignored'] as const;
export type IncidentStatus = typeof incidentStatusEnum[number];

export const incidents = pgTable('incidents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  incidentType: varchar('incident_type', { length: 100 }).notNull(),
  severity: varchar('severity', { length: 50 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  context: jsonb('context'),
  entityType: varchar('entity_type', { length: 50 }),
  entityKey: text('entity_key'),
  status: varchar('status', { length: 50 }).default('open'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  notificationSent: boolean('notification_sent').default(false),
  notificationChannel: varchar('notification_channel', { length: 50 }),
  notificationSentAt: timestamp('notification_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  idxIncidentsStatus: index('idx_incidents_status').on(table.status, table.severity),
  idxIncidentsWorkspace: index('idx_incidents_workspace').on(table.workspaceId),
}));

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;
