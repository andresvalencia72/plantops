import { sql } from 'drizzle-orm';
import {
  bigint, check, foreignKey, integer, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { assets } from './assets.js';
import { memberships, organizations } from './organizations.js';
import { plants } from './plants.js';

/** Append-only, tenant-safe movements after a verified first assignment. */
export const assetPlantTransfers = pgTable('asset_plant_transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  assetId: uuid('asset_id').notNull(),
  fromPlantId: uuid('from_plant_id').notNull(),
  toPlantId: uuid('to_plant_id').notNull(),
  fromTimeZone: text('from_time_zone').notNull(),
  toTimeZone: text('to_time_zone').notNull(),
  actorMembershipId: uuid('actor_membership_id').notNull(),
  reason: text('reason').notNull(),
  expectedVersion: integer('expected_version').notNull(),
  version: integer('version').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  transactionId: bigint('transaction_id', { mode: 'number' })
    .notNull().default(sql`txid_current()`),
  movedAt: timestamp('moved_at', { withTimezone: true })
    .notNull().defaultNow(),
}, (table) => [
  unique('asset_plant_transfer_version_once').on(
    table.organizationId, table.assetId, table.version,
  ),
  unique('asset_plant_transfer_actor_retry').on(
    table.organizationId, table.actorMembershipId, table.idempotencyKey,
  ),
  check('asset_plant_transfer_validity', sql`
    ${table.fromPlantId} <> ${table.toPlantId}
    AND ${table.expectedVersion} >= 0
    AND ${table.version} = ${table.expectedVersion} + 1
    AND ${table.version} <= 2147483647
    AND length(${table.fromTimeZone}) BETWEEN 3 AND 128
    AND length(${table.toTimeZone}) BETWEEN 3 AND 128
    AND length(${table.reason}) BETWEEN 10 AND 1000
  `),
  foreignKey({
    name: 'asset_plant_transfer_asset_tenant_fk',
    columns: [table.organizationId, table.assetId],
    foreignColumns: [assets.organizationId, assets.id],
  }),
  foreignKey({
    name: 'asset_plant_transfer_from_tenant_fk',
    columns: [table.organizationId, table.fromPlantId],
    foreignColumns: [plants.organizationId, plants.id],
  }),
  foreignKey({
    name: 'asset_plant_transfer_to_tenant_fk',
    columns: [table.organizationId, table.toPlantId],
    foreignColumns: [plants.organizationId, plants.id],
  }),
  foreignKey({
    name: 'asset_plant_transfer_actor_tenant_fk',
    columns: [table.organizationId, table.actorMembershipId],
    foreignColumns: [memberships.organizationId, memberships.id],
  }),
]);
