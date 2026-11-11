import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { SessionService } from '@nestjs/authentication';
import { NodeAdapter } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { users } from '../src/database/organizations.js';

const urlString = process.env.DATABASE_TEST_URL;
if (!urlString) throw new Error('DATABASE_TEST_URL is required');
const target = new URL(urlString);
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) throw new Error('HTTP integration requires a disposable local *_test database');

let app: INestApplication<App>;
const pool = new Pool({ connectionString: urlString });
const database = drizzle(pool);
const userId = randomUUID();
let sessionService: SessionService;

describe('HTTP session protection (PostgreSQL integration)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = urlString;
    await migrate(database, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await database.insert(users).values({ id: userId, displayName: 'Test HTTP user' });
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
    sessionService = app.get(SessionService);
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
    delete process.env.DATABASE_URL;
  });

  it('makes the single explicit public health endpoint available', async () => {
    await request(app.getHttpServer())
      .get('/health').expect(200).expect({ status: 'ok' });
  });

  it('rejects no cookie and an invalid cookie with 401', async () => {
    await request(app.getHttpServer()).get('/auth/session').expect(401);
    await request(app.getHttpServer())
      .get('/auth/session').set('Cookie', '__Host-sid=not-a-token').expect(401);
  });

  it('loads the session user from the database and rejects revocation', async () => {
    const issued = await sessionService.create(userId);
    await request(app.getHttpServer())
      .get('/auth/session')
      .set('Cookie', issued.cookie)
      .expect(200)
      .expect({ userId });

    await sessionService.revokeAll(userId);
    await request(app.getHttpServer())
      .get('/auth/session')
      .set('Cookie', issued.cookie)
      .expect(401);
  });

  it('logs out only the current browser session and expires its cookie', async () => {
    const first = await sessionService.create(userId);
    const second = await sessionService.create(userId);
    try {
      await request(app.getHttpServer())
        .get('/auth/session').set('Cookie', first.cookie)
        .expect(200);
      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', first.cookie)
        .set('Sec-Fetch-Site', 'same-origin')
        .expect(204);
      const cleared = response.headers['set-cookie'];
      const cookies = Array.isArray(cleared) ? cleared : [cleared];
      expect(cookies.some((cookie: string | undefined) =>
        cookie?.includes('Max-Age=0') && cookie.includes('HttpOnly') &&
        cookie.includes('Secure'))).toBe(true);
      await request(app.getHttpServer())
        .get('/auth/session').set('Cookie', first.cookie)
        .expect(401);
      await request(app.getHttpServer())
        .get('/auth/session').set('Cookie', second.cookie)
        .expect(200).expect({ userId });
    } finally {
      await sessionService.revokeAll(userId);
    }
  });

  it('refuses a logout without a valid session', async () => {
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Sec-Fetch-Site', 'same-origin')
      .expect(401);
  });

  it('refuses cross-site logout and preserves the existing session', async () => {
    const current = await sessionService.create(userId);
    try {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', current.cookie)
        .set('Origin', 'https://evil.invalid')
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(403);
      await request(app.getHttpServer())
        .get('/auth/session')
        .set('Cookie', current.cookie)
        .expect(200).expect({ userId });
    } finally {
      await sessionService.revokeAll(userId);
    }
  });

  it('does not trust cookies on an unsafe cross-origin request', async () => {
    const issued = await sessionService.create(userId);
    try {
      await request(app.getHttpServer())
        .post('/auth/session')
        .set('Cookie', issued.cookie)
        .set('Origin', 'https://evil.invalid')
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(403);
    } finally {
      await sessionService.revokeAll(userId);
    }
  });
});
