import {
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { assets } from './assets.js';
import { memberships, organizations } from './organizations.js';

export const incidentStatus = pgEnum('incident_status', [
  'REPORTED',
  'UNDER_REVIEW',
  'IN_PROGRESS',
  'CLOSED',
]);

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    assetId: uuid('asset_id').notNull(),
    reportedByMembershipId: uuid('reported_by_membership_id').notNull(),
    // Nullable only for records from before the idempotency contract.
    // The new report use case will require a key and a request hash.
    idempotencyKey: uuid('idempotency_key'),
    requestHash: text('request_hash'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: incidentStatus('status').notNull().default('REPORTED'),
    reportedAt: timestamp('reported_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('incidents_organization_id_id').on(
      table.organizationId,
      table.id,
    ),
    // Descending keyset scans stay bounded inside one organization.
    index('incidents_org_reported_id_idx').on(
      table.organizationId,
      table.reportedAt.desc(),
      table.id.desc(),
    ),
    // One report per retry key AND membership, even with concurrent requests.
    unique('incidents_actor_idempotency_key').on(
      table.organizationId,
      table.reportedByMembershipId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: 'incidents_asset_same_organization_fk',
      columns: [table.organizationId, table.assetId],
      foreignColumns: [assets.organizationId, assets.id],
    }),
    foreignKey({
      name: 'incidents_reporter_same_organization_fk',
      columns: [table.organizationId, table.reportedByMembershipId],
      foreignColumns: [
        memberships.organizationId,
        memberships.id,
      ],
    }),
  ],
);
