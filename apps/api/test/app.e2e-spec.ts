import { INestApplication } from '@nestjs/common';
import { NodeAdapter } from '@nestjs/platform-node';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';

describe('Foundation API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = fixture.createNestApplication(new NodeAdapter());
    await app.init();
  });

  it('GET /health returns only process liveness', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('does not expose the generated root Hello World route', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });

  afterEach(async () => {
    await app.close();
  });
});
