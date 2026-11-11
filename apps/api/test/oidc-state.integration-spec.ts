import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { OidcTransaction } from '@nestjs/authentication';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresOidcStateStore } from '../src/auth/postgres-oidc-state.store.js';
import { oidcStates } from '../src/auth/oidc-state.schema.js';
import { users } from '../src/database/organizations.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const target = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) {
  throw new Error('Only disposable localhost *_test databases are allowed');
}
const pool = new Pool({ connectionString: raw, max: 10 });
const db = drizzle(pool);
const store = new PostgresOidcStateStore(db);
const userId = randomUUID();

function transaction(
  at = new Date(Date.now()),
  ttl = 60_000,
): OidcTransaction {
  return {
    state: randomBytes(32).toString('base64url'),
    provider: 'google',
    nonce: randomBytes(16).toString('base64url'),
    codeVerifier: randomBytes(32).toString('base64url'),
    redirectTo: '/dashboard',
    createdAt: at,
    expiresAt: new Date(at.getTime() + ttl),
  };
}

describe('OIDC state uses atomic PostgreSQL storage', () => {
  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(users).values({ id: userId, displayName: 'OIDC test user' });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('preserves PKCE and nonce without exposing them in a client cookie', async () => {
    const state = transaction();
    await store.saveOidcState(state);
    expect(await store.consumeOidcState(state.state)).toEqual(state);
  });

  it('accepts a callback at most once even with concurrent requests', async () => {
    const state = transaction();
    await store.saveOidcState(state);
    const consumed = await Promise.all(
      Array.from({ length: 8 }, () => store.consumeOidcState(state.state)),
    );
    expect(consumed.filter(Boolean)).toHaveLength(1);
    expect(await store.consumeOidcState(state.state)).toBeUndefined();
  });

  it('keeps the linking user and session in the server-side transaction', async () => {
    const state = { ...transaction(), link: {
      userId,
      sessionId: randomBytes(32).toString('base64url'),
    } };
    await store.saveOidcState(state);
    expect(await store.consumeOidcState(state.state)).toEqual(state);
  });

  it('removes expired states when a new login is saved', async () => {
    const timestamp = new Date(Date.now());
    const expired = transaction(
      new Date(timestamp.getTime() - 120_000), 60_000,
    );
    await store.saveOidcState(expired);
    const fresh = transaction(timestamp);
    await store.saveOidcState(fresh);
    expect(await store.consumeOidcState(expired.state)).toBeUndefined();
    expect(await store.consumeOidcState(fresh.state)).toEqual(fresh);
  });

  it('drops the oldest pending transaction when a small test cap is reached', async () => {
    const capped = new PostgresOidcStateStore(db, 3);
    const base = Date.now();
    const states = Array.from({ length: 5 }, (_, i) =>
      transaction(new Date(base + i), 120_000 + i),
    );
    for (const item of states) await capped.saveOidcState(item);
    const keys = await db.select({ state: oidcStates.state }).from(oidcStates);
    expect(keys.length).toBeLessThanOrEqual(3);
    expect(keys.some((row) => row.state === states[0]?.state)).toBe(false);
    expect(await capped.consumeOidcState(states[4]!.state)).toEqual(states[4]);
    await db.delete(oidcStates).where(eq(oidcStates.provider, 'google'));
  });
});
