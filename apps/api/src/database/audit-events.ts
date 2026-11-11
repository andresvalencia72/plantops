import { sql } from 'drizzle-orm';
import {
  check, foreignKey, pgEnum, pgTable, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { incidents, incidentStatus } from './incidents.js';
import { memberships, organizations } from './organizations.js';

/** v0.1: only audited incident review; expand the enum with future use cases. */
export const auditAction = pgEnum('audit_action', [
  'INCIDENT_REVIEW_STARTED',
]);

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  incidentId: uuid('incident_id').notNull(),
  actorMembershipId: uuid('actor_membership_id').notNull(),
  action: auditAction('action').notNull(),
  fromStatus: incidentStatus('from_status').notNull(),
  toStatus: incidentStatus('to_status').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: 'audit_event_incident_same_org_fk',
    columns: [table.organizationId, table.incidentId],
    foreignColumns: [incidents.organizationId, incidents.id],
  }),
  foreignKey({
    name: 'audit_event_actor_same_org_fk',
    columns: [table.organizationId, table.actorMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
  unique('audit_event_actor_action_retry').on(
    table.organizationId, table.actorMembershipId,
    table.action, table.idempotencyKey,
  ),
  check('audit_event_review_transition', sql`
    ${table.action} <> 'INCIDENT_REVIEW_STARTED'
    OR (${table.fromStatus} = 'REPORTED' AND ${table.toStatus} = 'UNDER_REVIEW')
  `),
]);
