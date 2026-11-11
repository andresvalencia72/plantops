import type {
  OidcStateStore,
  OidcTransaction,
} from '@nestjs/authentication';
import { lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { oidcStates } from './oidc-state.schema.js';

/** Stores PKCE, nonce and state server-side; callbacks consume exactly once. */
export class PostgresOidcStateStore implements OidcStateStore {
  constructor(
    private readonly database: NodePgDatabase,
    private readonly maxPending = 10_000,
  ) {
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new Error('maxPending must be a positive integer');
    }
  }

  async saveOidcState(transaction: OidcTransaction): Promise<void> {
    await this.database.transaction(async (tx) => {
      // Serialize cleanup/capping across API instances under concurrent logins.
      await tx.execute(sql`select pg_advisory_xact_lock(
        hashtext('plantops:oidc-state-cap')
      )`);
      await tx.insert(oidcStates).values({
        state: transaction.state,
        provider: transaction.provider,
        codeVerifier: transaction.codeVerifier,
        nonce: transaction.nonce,
        redirectTo: transaction.redirectTo,
        createdAt: transaction.createdAt,
        expiresAt: transaction.expiresAt,
        linkUserId: transaction.link?.userId,
        linkSessionId: transaction.link?.sessionId,
      });
      await tx.delete(oidcStates)
        .where(lte(oidcStates.expiresAt, transaction.createdAt));
      // Keep pending login storage bounded even if callers spam /login.
      await tx.execute(sql`
        delete from oidc_states where state in (
          select state from oidc_states
          order by expires_at desc, created_at desc, state
          offset ${this.maxPending}
        )
      `);
    });
  }

  async consumeOidcState(state: string): Promise<OidcTransaction | undefined> {
    const [record] = await this.database.delete(oidcStates)
      .where(sql`${oidcStates.state} = ${state}`)
      .returning();

    if (!record) return undefined;
    return {
      state: record.state,
      provider: record.provider,
      codeVerifier: record.codeVerifier,
      ...(record.nonce ? { nonce: record.nonce } : {}),
      ...(record.redirectTo ? { redirectTo: record.redirectTo } : {}),
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      ...(record.linkUserId && record.linkSessionId
        ? { link: { userId: record.linkUserId, sessionId: record.linkSessionId } }
        : {}),
    };
  }
}
