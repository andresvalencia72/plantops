import { sql } from 'drizzle-orm';
import {
  check, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

/**
 * A site within one tenant with a named IANA time zone.
 * Time zone membership is also checked by a PostgreSQL migration trigger.
 */
export const plants = pgTable('plants', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  timeZone: text('time_zone').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull().defaultNow(),
}, (table) => [
  unique('plants_organization_id_id').on(
    table.organizationId, table.id,
  ),
  unique('plants_organization_name').on(
    table.organizationId, table.name,
  ),
  check('plants_name_length', sql`
    length(${table.name}) BETWEEN 3 AND 160
  `),
  check('plants_iana_zone_format', sql`
    ${table.timeZone} ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$'
  `),
]);
