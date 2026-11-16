import { sql } from 'drizzle-orm';
import {
  boolean, check, date, foreignKey, index, integer, pgEnum,
  pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { maintenancePlans } from './maintenance-plans.js';
import { memberships, organizations } from './organizations.js';

export const planEventAction = pgEnum('maintenance_plan_event_action', [
  'PAUSED', 'RESUMED', 'SCHEDULE_CHANGED',
]);

/** Append-only snapshots of supervisor changes to plan state and calendar. */
export const maintenancePlanEvents = pgTable('maintenance_plan_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  planId: uuid('plan_id').notNull(),
  actorMembershipId: uuid('actor_membership_id').notNull(),
  action: planEventAction('action').notNull(),
  reason: text('reason').notNull(),
  fromVersion: integer('from_version').notNull(),
  toVersion: integer('to_version').notNull(),
  fromActive: boolean('from_active').notNull(),
  toActive: boolean('to_active').notNull(),
  fromIntervalDays: integer('from_interval_days').notNull(),
  toIntervalDays: integer('to_interval_days').notNull(),
  fromNextDueOn: date('from_next_due_on', { mode: 'string' }).notNull(),
  toNextDueOn: date('to_next_due_on', { mode: 'string' }).notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull().defaultNow(),
}, (table) => [
  unique('maintenance_plan_event_version_once').on(
    table.organizationId, table.planId, table.toVersion,
  ),
  unique('maintenance_plan_event_actor_retry').on(
    table.organizationId, table.actorMembershipId, table.idempotencyKey,
  ),
  index('maintenance_plan_event_history_idx').on(
    table.organizationId, table.planId, table.toVersion,
  ),
  check('maintenance_plan_event_version_transition', sql`
    ${table.fromVersion} >= 0 AND ${table.toVersion} = ${table.fromVersion} + 1
  `),
  check('maintenance_plan_event_reason_length', sql`
    length(${table.reason}) BETWEEN 10 AND 1000
  `),
  check('maintenance_plan_event_action_consistency', sql`
    (${table.action} = 'PAUSED' AND ${table.fromActive} = true
      AND ${table.toActive} = false
      AND ${table.fromIntervalDays} = ${table.toIntervalDays}
      AND ${table.fromNextDueOn} = ${table.toNextDueOn})
    OR (${table.action} = 'RESUMED' AND ${table.fromActive} = false
      AND ${table.toActive} = true
      AND ${table.fromIntervalDays} = ${table.toIntervalDays}
      AND ${table.fromNextDueOn} = ${table.toNextDueOn})
    OR (${table.action} = 'SCHEDULE_CHANGED'
      AND ${table.fromActive} = false AND ${table.toActive} = false
      AND (${table.fromIntervalDays} <> ${table.toIntervalDays}
        OR ${table.fromNextDueOn} <> ${table.toNextDueOn}))
  `),
  foreignKey({
    name: 'maintenance_plan_event_plan_tenant_fk',
    columns: [table.organizationId, table.planId],
    foreignColumns: [maintenancePlans.organizationId, maintenancePlans.id],
  }),
  foreignKey({
    name: 'maintenance_plan_event_actor_tenant_fk',
    columns: [table.organizationId, table.actorMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
]);
