import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '../database/organizations.js';

// The cookie contains the raw 256-bit secret; only its SHA-256 digest is stored.
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull(),
    mfa: text('mfa', { enum: ['pending', 'verified'] }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
    check('sessions_mfa_state', sql`${table.mfa} is null or ${table.mfa} in ('pending', 'verified')`),
  ],
);
