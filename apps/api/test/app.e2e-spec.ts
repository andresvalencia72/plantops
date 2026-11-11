import { INestApplication } from '@nestjs/common';
import { NodeAdapter } from '@nestjs/platform-node';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';

describe('Foundation API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    // No HTTP auth handshake in these smoke tests: no database is contacted.
    process.env.DATABASE_URL ??=
      'postgresql://test:test@127.0.0.1:5432/plantops_test';

    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = fixture.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection();
    await app.init();
  });

  it('GET /health returns only process liveness', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('denies the session endpoint without valid credentials', async () => {
    await request(app.getHttpServer()).get('/auth/session').expect(401);
    await request(app.getHttpServer())
      .get('/auth/session')
      .set('Cookie', '__Host-sid=invalid-cookie')
      .expect(401);
  });

  it('does not expose OIDC routes when credentials are not configured', async () => {
    await request(app.getHttpServer())
      .get('/auth/oidc/google/login')
      .expect(404);
  });

  it('does not expose the generated root Hello World route', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });

  afterEach(async () => {
    await app.close();
  });
});
