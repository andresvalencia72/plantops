import { boolean, foreignKey, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { plants } from './plants.js';

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
    plantId: uuid('plant_id'),
  },
  (table) => [
    unique('assets_organization_code').on(table.organizationId, table.code),
    unique('assets_organization_id_id').on(table.organizationId, table.id),
    foreignKey({
      name: 'assets_plant_tenant_fk',
      columns: [table.organizationId, table.plantId],
      foreignColumns: [plants.organizationId, plants.id],
    }),
  ],
);
