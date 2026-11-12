import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, pgTable, text,
  timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { incidents, incidentStatus } from './incidents.js';
import { memberships, organizations } from './organizations.js';

/** One immutable supervisory closure per incident, including terminal OT counts. */
export const incidentClosures = pgTable('incident_closures', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  incidentId: uuid('incident_id').notNull(),
  actorMembershipId: uuid('actor_membership_id').notNull(),
  fromStatus: incidentStatus('from_status').notNull(),
  reason: text('reason').notNull(),
  conclusion: text('conclusion'),
  orderCount: integer('order_count').notNull(),
  completedCount: integer('completed_count').notNull(),
  cancelledCount: integer('cancelled_count').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true })
    .notNull().defaultNow(),
}, (table) => [
  unique('incident_closure_once').on(table.organizationId, table.incidentId),
  unique('incident_closure_actor_retry').on(
    table.organizationId, table.actorMembershipId, table.idempotencyKey,
  ),
  check('incident_closure_consistency', sql`
    ${table.orderCount} >= 0 AND ${table.completedCount} >= 0
      AND ${table.cancelledCount} >= 0
      AND ${table.completedCount} + ${table.cancelledCount} = ${table.orderCount}
      AND length(${table.reason}) BETWEEN 10 AND 1000
      AND (( ${table.orderCount} = 0 AND ${table.fromStatus} = 'UNDER_REVIEW'
        AND ${table.conclusion} IS NULL)
      OR (${table.orderCount} > 0 AND ${table.fromStatus} = 'IN_PROGRESS'
        AND length(${table.conclusion}) BETWEEN 20 AND 4000))
  `),
  foreignKey({
    name: 'incident_closure_incident_tenant_fk',
    columns: [table.organizationId, table.incidentId],
    foreignColumns: [incidents.organizationId, incidents.id],
  }),
  foreignKey({
    name: 'incident_closure_actor_tenant_fk',
    columns: [table.organizationId, table.actorMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
]);
