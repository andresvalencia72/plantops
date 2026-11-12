import { sql } from 'drizzle-orm';
import {
  check, foreignKey, index, integer, pgEnum, pgTable,
  text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { memberships, organizations } from './organizations.js';
import { workOrders } from './work-orders.js';

export const workOrderAssignmentAction = pgEnum('work_order_assignment_action', [
  'ASSIGNED', 'REASSIGNED',
]);

/** UC-05: each version is an immutable transition, not an overwritten audit row. */
export const workOrderAssignments = pgTable('work_order_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  workOrderId: uuid('work_order_id').notNull(),
  actorMembershipId: uuid('actor_membership_id').notNull(),
  fromMembershipId: uuid('from_membership_id'),
  toMembershipId: uuid('to_membership_id').notNull(),
  action: workOrderAssignmentAction('action').notNull(),
  version: integer('version').notNull(),
  reason: text('reason'),
  idempotencyKey: uuid('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull().defaultNow(),
}, (table) => [
  unique('work_order_assignment_version_once').on(
    table.organizationId, table.workOrderId, table.version,
  ),
  unique('work_order_assignment_actor_retry').on(
    table.organizationId, table.actorMembershipId, table.idempotencyKey,
  ),
  index('work_order_assignments_history_idx').on(
    table.organizationId, table.workOrderId, table.version,
  ),
  check('work_order_assignment_transition', sql`(
    (${table.action} = 'ASSIGNED' AND ${table.fromMembershipId} IS NULL
      AND ${table.version} = 1)
    OR (${table.action} = 'REASSIGNED' AND ${table.fromMembershipId} IS NOT NULL
      AND ${table.version} >= 2)
  ) AND ${table.fromMembershipId} IS DISTINCT FROM ${table.toMembershipId}`),
  check('work_order_assignment_reason_length', sql`
    ${table.reason} IS NULL OR length(${table.reason}) BETWEEN 3 AND 500
  `),
  foreignKey({
    name: 'work_order_assignment_order_tenant_fk',
    columns: [table.organizationId, table.workOrderId],
    foreignColumns: [workOrders.organizationId, workOrders.id],
  }),
  foreignKey({
    name: 'work_order_assignment_actor_tenant_fk',
    columns: [table.organizationId, table.actorMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
  foreignKey({
    name: 'work_order_assignment_from_tenant_fk',
    columns: [table.organizationId, table.fromMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
  foreignKey({
    name: 'work_order_assignment_to_tenant_fk',
    columns: [table.organizationId, table.toMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
]);
