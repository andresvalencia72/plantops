import { sql } from 'drizzle-orm';
import {
  bigint, check, foreignKey, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { assets } from './assets.js';
import { memberships, organizations } from './organizations.js';
import { plants } from './plants.js';

/**
 * Immutable audit of the FIRST plant assignment only. SQL guards prohibit
 * reassignment until a distinct history-aware operation is designed.
 */
export const assetPlantAssignments = pgTable('asset_plant_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  assetId: uuid('asset_id').notNull(),
  plantId: uuid('plant_id').notNull(),
  actorMembershipId: uuid('actor_membership_id').notNull(),
  reason: text('reason').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  transactionId: bigint('transaction_id', { mode: 'number' })
    .notNull().default(sql`txid_current()`),
  assignedAt: timestamp('assigned_at', { withTimezone: true })
    .notNull().defaultNow(),
}, (table) => [
  unique('asset_plant_assignment_once').on(
    table.organizationId, table.assetId,
  ),
  unique('asset_plant_assignment_actor_retry').on(
    table.organizationId, table.actorMembershipId, table.idempotencyKey,
  ),
  check('asset_plant_assignment_reason_length', sql`
    length(${table.reason}) BETWEEN 10 AND 1000
  `),
  foreignKey({
    name: 'asset_plant_assignment_asset_tenant_fk',
    columns: [table.organizationId, table.assetId],
    foreignColumns: [assets.organizationId, assets.id],
  }),
  foreignKey({
    name: 'asset_plant_assignment_plant_tenant_fk',
    columns: [table.organizationId, table.plantId],
    foreignColumns: [plants.organizationId, plants.id],
  }),
  foreignKey({
    name: 'asset_plant_assignment_actor_tenant_fk',
    columns: [table.organizationId, table.actorMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
]);
