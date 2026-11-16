import { sql } from 'drizzle-orm';
import {
  check, date, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { assets } from './assets.js';
import { incidents } from './incidents.js';
import { memberships, organizations } from './organizations.js';
import { maintenancePlans } from './maintenance-plans.js';

export const workOrderKind = pgEnum('work_order_kind', ['CORRECTIVE', 'PREVENTIVE']);

export const workOrderStatus = pgEnum('work_order_status', [
  'PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
]);

/** A preventive order has no incident; tenant + asset FKs still apply. */
export const workOrders = pgTable('work_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  incidentId: uuid('incident_id'),
  kind: workOrderKind('kind').notNull().default('CORRECTIVE'),
  maintenancePlanId: uuid('maintenance_plan_id'),
  scheduledFor: date('scheduled_for', { mode: 'string' }),
  assetId: uuid('asset_id').notNull(),
  createdByMembershipId: uuid('created_by_membership_id').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: workOrderStatus('status').notNull().default('PENDING'),
  responsibleMembershipId: uuid('responsible_membership_id'),
  assignmentVersion: integer('assignment_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull().defaultNow(),
}, (table) => [
  unique('work_orders_organization_id_id').on(table.organizationId, table.id),
  check('work_order_kind_incident_consistency', sql`
    (${table.kind} = 'CORRECTIVE' AND ${table.incidentId} IS NOT NULL
      AND ${table.maintenancePlanId} IS NULL AND ${table.scheduledFor} IS NULL)
    OR (${table.kind} = 'PREVENTIVE' AND ${table.incidentId} IS NULL
      AND ((${table.maintenancePlanId} IS NULL AND ${table.scheduledFor} IS NULL)
        OR (${table.maintenancePlanId} IS NOT NULL AND ${table.scheduledFor} IS NOT NULL)))
  `),
  check('work_order_assignee_state', sql`
    (${table.status} = 'PENDING' AND ${table.responsibleMembershipId} IS NULL
      AND ${table.assignmentVersion} = 0)
    OR (${table.status} = 'ASSIGNED' AND ${table.responsibleMembershipId} IS NOT NULL
      AND ${table.assignmentVersion} >= 1)
    OR (${table.status} NOT IN ('PENDING', 'ASSIGNED')
      AND ${table.assignmentVersion} >= 0)
  `),
  unique('work_order_actor_retry').on(
    table.organizationId, table.createdByMembershipId, table.idempotencyKey,
  ),
  unique('work_order_plan_due_once').on(
    table.organizationId, table.maintenancePlanId, table.scheduledFor,
  ),
  index('work_orders_organization_incident_idx').on(
    table.organizationId, table.incidentId, table.createdAt.desc(),
  ),
  foreignKey({
    name: 'work_order_incident_asset_tenant_fk',
    columns: [table.organizationId, table.incidentId, table.assetId],
    foreignColumns: [incidents.organizationId, incidents.id, incidents.assetId],
  }),
  foreignKey({
    name: 'work_order_maintenance_plan_asset_tenant_fk',
    columns: [table.organizationId, table.maintenancePlanId, table.assetId],
    foreignColumns: [
      maintenancePlans.organizationId, maintenancePlans.id, maintenancePlans.assetId,
    ],
  }),
  foreignKey({
    name: 'work_order_asset_tenant_fk',
    columns: [table.organizationId, table.assetId],
    foreignColumns: [assets.organizationId, assets.id],
  }),
  foreignKey({
    name: 'work_order_responsible_tenant_fk',
    columns: [table.organizationId, table.responsibleMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
  foreignKey({
    name: 'work_order_creator_tenant_fk',
    columns: [table.organizationId, table.createdByMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
]);
