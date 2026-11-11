import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  membershipRole,
  organizations,
  users,
} from '../database/organizations.js';

/** Subject is the stable identity, never an email address. */
export const oidcAccounts = pgTable(
  'oidc_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true })
      .notNull().defaultNow(),
  },
  (table) => [
    unique('oidc_accounts_provider_subject_unique')
      .on(table.provider, table.subject),
    unique('oidc_accounts_user_provider_unique')
      .on(table.userId, table.provider),
  ],
);

/** Explicit invitations are provisioned administratively, never self-issued. */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull().references(() => organizations.id),
    email: text('email').notNull(),
    role: membershipRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedByUserId: uuid('consumed_by_user_id').references(() => users.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('invitations_pending_organization_email')
      .on(table.organizationId, table.email)
      .where(sql`${table.consumedAt} is null and ${table.revokedAt} is null`),
    index('invitations_email_idx').on(table.email),
    check('invitations_email_normalized',
      sql`${table.email} = lower(trim(${table.email})) and char_length(${table.email}) > 3`),
    check('invitations_valid_expiry',
      sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
