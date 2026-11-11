import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AuthenticationStorage, SessionService } from '@nestjs/authentication';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresSessionStore } from '../src/auth/postgres-session-store.js';
import { users } from '../src/database/organizations.js';

const rawUrl = process.env.DATABASE_TEST_URL;
if (!rawUrl) throw new Error('DATABASE_TEST_URL required');
const url = new URL(rawUrl);
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  !url.pathname.endsWith('_test')
) throw new Error('Test must use disposable local *_test PostgreSQL');

const pool = new Pool({ connectionString: rawUrl });
const db = drizzle(pool);
const storage = new AuthenticationStorage({
  contracts: [], allowInMemoryStorage: false,
});
storage.registerSource({ sessions: new PostgresSessionStore(db) });
const userId = randomUUID();

describe('official NestJS SessionService with persistent PostgreSQL', () => {
  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(users).values({ id: userId, displayName: 'Auth lifecycle user' });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('stores only a SHA256 token digest and accepts live raw cookie tokens', async () => {
    const service = new SessionService(storage, {
      session: { absoluteTtl: '1h', idleTtl: '10m' },
    });
    const issued = await service.create(userId);
    expect(issued.token).not.toBe(issued.session.id);
    expect(issued.session.id).toBe(
      createHash('sha256').update(issued.token).digest('hex'),
    );
    expect((await service.validate(issued.token))?.userId).toBe(userId);
    expect(await service.validate(randomUUID())).toBeNull();
    await service.revokeAll(userId);
  });

  it('enforces inactivity and absolute expiry without relying on the browser', async () => {
    let time = new Date('2026-11-11T10:00:00Z').getTime();
    const service = new SessionService(storage, {
      session: {
        absoluteTtl: '10m',
        idleTtl: '1m',
        touchInterval: 0,
        now: () => time,
      },
    });
    const first = await service.create(userId);
    time += 61_000;
    expect(await service.validate(first.token)).toBeNull();

    const second = await service.create(userId);
    time += 20_000;
    expect(await service.validate(second.token)).not.toBeNull();
    time += 20_000;
    expect(await service.validate(second.token)).not.toBeNull();
    time += 600_000;
    expect(await service.validate(second.token)).toBeNull();
    await service.revokeAll(userId);
  });

  it('invalidates an old token on rotation and revokes all user sessions', async () => {
    const service = new SessionService(storage, {
      session: { absoluteTtl: '1h', idleTtl: '10m' },
    });
    const old = await service.create(userId);
    const replacement = await service.rotate(old.session);
    expect(replacement).not.toBeNull();
    expect(await service.validate(old.token)).toBeNull();
    expect(await service.validate(replacement?.token)).not.toBeNull();
    await service.revokeAll(userId);
    expect(await service.validate(replacement?.token)).toBeNull();
  });

  it('cannot rotate the same session twice concurrently', async () => {
    const service = new SessionService(storage, {
      session: { absoluteTtl: '1h', idleTtl: '10m' },
    });
    const original = await service.create(userId);
    const rotations = await Promise.all([
      service.rotate(original.session),
      service.rotate(original.session),
    ]);
    expect(rotations.filter(Boolean)).toHaveLength(1);
    await service.revokeAll(userId);
    expect(await service.list(userId)).toHaveLength(0);
  });
});
