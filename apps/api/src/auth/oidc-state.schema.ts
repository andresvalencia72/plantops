import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../database/organizations.js';

/**
 * Pending PKCE / nonce state is stored server-side, not in browser storage.
 * Deletion must be atomic: two callback attempts must not consume one state.
 */
export const oidcStates = pgTable(
  'oidc_states',
  {
    state: text('state').primaryKey(),
    provider: text('provider').notNull(),
    nonce: text('nonce'),
    codeVerifier: text('code_verifier').notNull(),
    redirectTo: text('redirect_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    linkUserId: uuid('link_user_id').references(() => users.id),
    linkSessionId: text('link_session_id'),
  },
  (table) => [
    index('oidc_states_expiry_idx').on(table.expiresAt),
  ],
);
