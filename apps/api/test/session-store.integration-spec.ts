import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { SessionRecord } from '@nestjs/authentication';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresSessionStore } from '../src/auth/postgres-session-store.js';
import { users } from '../src/database/organizations.js';

const rawUrl = process.env.DATABASE_TEST_URL;
if (!rawUrl) throw new Error('DATABASE_TEST_URL is required');
const url = new URL(rawUrl);
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  !url.pathname.endsWith('_test')
) throw new Error('Only a local disposable *_test database is allowed');

const pool = new Pool({ connectionString: rawUrl });
const db = drizzle(pool);
const store = new PostgresSessionStore(db);
const userA = randomUUID();
const userB = randomUUID();

const now = new Date('2026-11-11T10:00:00.000Z');
function record(userId = userA): SessionRecord {
  return {
    id: randomBytes(32).toString('hex'),
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    lastActiveAt: now,
    metadata: { userAgent: 'Vitest' },
  };
}

describe('official SessionStore implemented with PostgreSQL', () => {
  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(users).values([
      { id: userA, displayName: 'Session test A' },
      { id: userB, displayName: 'Session test B' },
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('persists and reads a session with metadata and optional MFA', async () => {
    const initial = { ...record(), mfa: 'verified' as const };
    await store.createSession(initial);
    expect(await store.getSession(initial.id)).toEqual(initial);
  });

  it('returns undefined when the session does not exist', async () => {
    expect(await store.getSession(randomBytes(32).toString('hex'))).toBeUndefined();
  });

  it('only moves last activity forward and never resurrects a deleted session', async () => {
    const initial = record();
    await store.createSession(initial);
    const future = new Date(now.getTime() + 30_000);
    const older = new Date(now.getTime() + 10_000);
    await Promise.all([
      store.touchSession(initial.id, future),
      store.touchSession(initial.id, older),
    ]);
    expect((await store.getSession(initial.id))?.lastActiveAt).toEqual(future);
    expect(await store.deleteSession(initial.id)).toBe(true);
    await store.touchSession(initial.id, new Date(now.getTime() + 60_000));
    expect(await store.getSession(initial.id)).toBeUndefined();
    expect(await store.deleteSession(initial.id)).toBe(false);
  });

  it('deletes one session once under simultaneous revocation attempts', async () => {
    const initial = record();
    await store.createSession(initial);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.deleteSession(initial.id)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.getSession(initial.id)).toBeUndefined();
  });

  it('lists and revokes all sessions only for the requested user', async () => {
    const a = [record(userA), record(userA)];
    const b = record(userB);
    await Promise.all([...a, b].map((session) => store.createSession(session)));
    const before = await store.listUserSessions(userA);
    expect(a.every((session) => before.some((row) => row.id === session.id))).toBe(true);
    await store.deleteUserSessions(userA);
    expect(await store.listUserSessions(userA)).toEqual([]);
    expect(await store.getSession(b.id)).toEqual(b);
  });
});
