import { boolean, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (table) => [
    unique('assets_organization_code').on(table.organizationId, table.code),
    unique('assets_organization_id_id').on(table.organizationId, table.id),
  ],
);
