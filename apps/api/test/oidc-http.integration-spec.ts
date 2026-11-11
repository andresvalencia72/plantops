import { INestApplication } from '@nestjs/common';
import { NodeAdapter } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';

const database = process.env.DATABASE_TEST_URL;
if (!database) throw new Error('DATABASE_TEST_URL required');
const target = new URL(database);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) {
  throw new Error('OIDC integration tests require disposable localhost DB');
}

describe('opt-in OIDC HTTP routing without real provider credentials', () => {
  let app: INestApplication<App>;
  const previous = new Map<string, string | undefined>();
  const settings: Record<string, string> = {
    DATABASE_URL: database!,
    OIDC_CALLBACK_ORIGIN: 'http://localhost:3001',
    GOOGLE_OIDC_CLIENT_ID: 'fixture-only-google-client',
    GOOGLE_OIDC_CLIENT_SECRET: 'fixture-only-secret',
  };

  beforeAll(async () => {
    for (const [key, value] of Object.entries(settings)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    vi.resetModules();
    const { AppModule } = await import('../src/app.module.js');
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .compile();
    app = fixture.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('lists enabled provider names without exposing credentials', async () => {
    const result = await request(app.getHttpServer())
      .get('/auth/oidc/providers')
      .expect(200);
    expect(result.body).toEqual({ providers: ['google'] });
    expect(result.text).not.toContain('fixture-only-secret');
    expect(result.text).not.toContain('fixture-only-google-client');
  });

  it('still exposes only health without authentication', async () => {
    await request(app.getHttpServer()).get('/health')
      .expect(200).expect({ status: 'ok' });
    await request(app.getHttpServer()).get('/auth/session').expect(401);
  });

  it('rejects unknown providers before making any external request', async () => {
    await request(app.getHttpServer())
      .get('/auth/oidc/unconfigured/login')
      .expect(404);
  });

  it('refuses a callback without state and browser transaction cookie', async () => {
    await request(app.getHttpServer())
      .get('/auth/oidc/google/callback?code=untrusted-code')
      .expect(400);
  });
});
