import {
  foreignKey,
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
