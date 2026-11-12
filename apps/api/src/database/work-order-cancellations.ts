import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { memberships, organizations } from './organizations.js';
import { workOrderStatus, workOrders } from './work-orders.js';

/** UC-07: one immutable cancellation record per corrective order. */
export const workOrderCancellations = pgTable('work_order_cancellations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  workOrderId: uuid('work_order_id').notNull(),
  actorMembershipId: uuid('actor_membership_id').notNull(),
  fromStatus: workOrderStatus('from_status').notNull(),
  reason: text('reason').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull().defaultNow(),
}, (table) => [
  unique('work_order_cancellation_once').on(table.organizationId, table.workOrderId),
  unique('work_order_cancellation_actor_retry').on(
    table.organizationId, table.actorMembershipId, table.idempotencyKey,
  ),
  check('work_order_cancellation_valid', sql`
    ${table.fromStatus} IN ('PENDING','ASSIGNED','IN_PROGRESS')
    AND length(${table.reason}) BETWEEN 10 AND 1000
  `),
  foreignKey({
    name: 'work_order_cancellation_order_tenant_fk',
    columns: [table.organizationId, table.workOrderId],
    foreignColumns: [workOrders.organizationId, workOrders.id],
  }),
  foreignKey({
    name: 'work_order_cancellation_actor_tenant_fk',
    columns: [table.organizationId, table.actorMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
]);
