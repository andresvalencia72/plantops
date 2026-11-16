import { sql } from 'drizzle-orm';
import {
  boolean, check, date, foreignKey, integer, pgTable, text,
  timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { assets } from './assets.js';
import { memberships, organizations } from './organizations.js';

/** UTC calendar-day recurring plans. No scheduled job runs from this table. */
export const maintenancePlans = pgTable('maintenance_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  assetId: uuid('asset_id').notNull(),
  createdByMembershipId: uuid('created_by_membership_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  intervalDays: integer('interval_days').notNull(),
  nextDueOn: date('next_due_on', { mode: 'string' }).notNull(),
  active: boolean('active').notNull().default(true),
  idempotencyKey: uuid('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull().defaultNow(),
}, (table) => [
  unique('maintenance_plan_organization_id_id_asset').on(
    table.organizationId, table.id, table.assetId,
  ),
  unique('maintenance_plan_actor_retry').on(
    table.organizationId, table.createdByMembershipId, table.idempotencyKey,
  ),
  check('maintenance_plan_interval_days_valid', sql`
    ${table.intervalDays} BETWEEN 1 AND 365
  `),
  check('maintenance_plan_title_length', sql`
    length(${table.title}) BETWEEN 3 AND 160
  `),
  check('maintenance_plan_description_length', sql`
    length(${table.description}) BETWEEN 10 AND 4000
  `),
  foreignKey({
    name: 'maintenance_plan_asset_tenant_fk',
    columns: [table.organizationId, table.assetId],
    foreignColumns: [assets.organizationId, assets.id],
  }),
  foreignKey({
    name: 'maintenance_plan_creator_tenant_fk',
    columns: [table.organizationId, table.createdByMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
]);
