import { sql } from 'drizzle-orm';
import {
  check, foreignKey, pgEnum, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { memberships, organizations } from './organizations.js';
import { workOrders } from './work-orders.js';
import { workOrderStatus } from './work-orders.js';

export const workOrderExecutionAction = pgEnum('work_order_execution_action', [
  'STARTED', 'COMPLETED',
]);

/** Only the active technician can append a start/completion transition. */
export const workOrderExecutions = pgTable('work_order_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  workOrderId: uuid('work_order_id').notNull(),
  actorMembershipId: uuid('actor_membership_id').notNull(),
  action: workOrderExecutionAction('action').notNull(),
  fromStatus: workOrderStatus('from_status').notNull(),
  toStatus: workOrderStatus('to_status').notNull(),
  result: text('result'),
  idempotencyKey: uuid('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull().defaultNow(),
}, (table) => [
  unique('work_order_execution_once').on(
    table.organizationId, table.workOrderId, table.action,
  ),
  unique('work_order_execution_actor_retry').on(
    table.organizationId, table.actorMembershipId, table.idempotencyKey,
  ),
  check('work_order_execution_transition', sql`(
    (${table.action} = 'STARTED' AND ${table.fromStatus} = 'ASSIGNED'
      AND ${table.toStatus} = 'IN_PROGRESS' AND ${table.result} IS NULL)
    OR (${table.action} = 'COMPLETED' AND ${table.fromStatus} = 'IN_PROGRESS'
      AND ${table.toStatus} = 'COMPLETED'
      AND length(${table.result}) BETWEEN 10 AND 4000)
  )`),
  foreignKey({
    name: 'work_order_execution_order_tenant_fk',
    columns: [table.organizationId, table.workOrderId],
    foreignColumns: [workOrders.organizationId, workOrders.id],
  }),
  foreignKey({
    name: 'work_order_execution_actor_tenant_fk',
    columns: [table.organizationId, table.actorMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
]);
