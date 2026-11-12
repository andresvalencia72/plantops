import { sql } from 'drizzle-orm';
import {
  check, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { assets } from './assets.js';
import { incidents } from './incidents.js';
import { memberships, organizations } from './organizations.js';

export const workOrderStatus = pgEnum('work_order_status', [
  'PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
]);

/** UC-04: corrective orders only; preventive orders are a separate migration. */
export const workOrders = pgTable('work_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  incidentId: uuid('incident_id').notNull(),
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
  index('work_orders_organization_incident_idx').on(
    table.organizationId, table.incidentId, table.createdAt.desc(),
  ),
  foreignKey({
    name: 'work_order_incident_asset_tenant_fk',
    columns: [table.organizationId, table.incidentId, table.assetId],
    foreignColumns: [incidents.organizationId, incidents.id, incidents.assetId],
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
