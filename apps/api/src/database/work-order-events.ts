import { sql } from 'drizzle-orm';
import { check, foreignKey, pgEnum, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { memberships, organizations } from './organizations.js';
import { incidentStatus } from './incidents.js';
import { workOrders } from './work-orders.js';

/** Separate append-only audit for orders without changing incident status. */
export const workOrderAuditAction = pgEnum('work_order_audit_action', [
  'WORK_ORDER_CREATED',
]);

export const workOrderEvents = pgTable('work_order_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  workOrderId: uuid('work_order_id').notNull(),
  actorMembershipId: uuid('actor_membership_id').notNull(),
  action: workOrderAuditAction('action').notNull(),
  fromIncidentStatus: incidentStatus('from_incident_status'),
  toIncidentStatus: incidentStatus('to_incident_status'),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull().defaultNow(),
}, (table) => [
  unique('work_order_event_once').on(
    table.organizationId, table.workOrderId, table.action,
  ),
  check('work_order_event_incident_transition', sql`
    (${table.fromIncidentStatus} IS NULL AND ${table.toIncidentStatus} IS NULL)
    OR (${table.fromIncidentStatus} IS NOT NULL
      AND ${table.toIncidentStatus} IS NOT NULL
      AND ${table.fromIncidentStatus} = 'UNDER_REVIEW'
      AND ${table.toIncidentStatus} = 'IN_PROGRESS')
  `),
  foreignKey({
    name: 'work_order_event_order_tenant_fk',
    columns: [table.organizationId, table.workOrderId],
    foreignColumns: [workOrders.organizationId, workOrders.id],
  }),
  foreignKey({
    name: 'work_order_event_actor_tenant_fk',
    columns: [table.organizationId, table.actorMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
]);
