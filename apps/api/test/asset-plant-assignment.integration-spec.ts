import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { INestApplication } from '@nestjs/common';
import { SessionService } from '@nestjs/authentication';
import { NodeAdapter } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { assetPlantAssignments } from '../src/database/asset-plant-assignments.js';
import { assets } from '../src/database/assets.js';
import { maintenancePlans } from '../src/database/maintenance-plans.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { plants } from '../src/database/plants.js';
import { workOrders } from '../src/database/work-orders.js';

const connection = process.env.DATABASE_TEST_URL;
if (!connection) throw new Error('DATABASE_TEST_URL required');
const target = new URL(connection);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Disposable DB only');
const pool = new Pool({ connectionString: connection, max: 20 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  supA: randomUUID(), sup2: randomUUID(), member: randomUUID(),
  supB: randomUUID(), actorA: randomUUID(), actor2: randomUUID(),
  actorMember: randomUUID(), actorB: randomUUID(),
  plantA: randomUUID(), plantB: randomUUID(),
  a: randomUUID(), b: randomUUID(), racing: randomUUID(),
  unassigned: randomUUID(), planned: randomUUID(),
  ordered: randomUUID(), inactive: randomUUID(), foreign: randomUUID(),
};
const reason = 'Asignación inicial aprobada tras inspeccionar la ubicación del equipo';
const base = (org: string = ids.orgA, asset: string = ids.a) =>
  `/organizations/${org}/assets/${asset}/plant-assignment`;
const sqlCode = (expected: string) => (error: unknown) => {
  const value = error as { code?: string; cause?: { code?: string } } | null;
  return value?.code === expected || value?.cause?.code === expected;
};

describe('Sprint 3P — audited initial plant assignment', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  function assign(asset: string = ids.a, plantId: string = ids.plantA,
    key: string = randomUUID(), cookie = cookies.supervisor,
    body: Record<string, unknown> = { plantId, reason }, org = ids.orgA) {
    const req = request(app.getHttpServer()).post(base(org, asset))
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Idempotency-Key', key).send(body);
    return cookie ? req.set('Cookie', cookie) : req;
  }
  const load = (id: string) => db.select().from(assets)
    .where(eq(assets.id, id)).then((rows) => rows[0]);
  const audit = (id: string) => db.select().from(assetPlantAssignments)
    .where(eq(assetPlantAssignments.assetId, id));
  beforeAll(async () => {
    process.env.DATABASE_URL = connection;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Plant assignment A' },
      { id: ids.orgB, name: 'Plant assignment B' },
    ]);
    await db.insert(users).values([
      { id: ids.supA, displayName: 'Assignment supervisor' },
      { id: ids.sup2, displayName: 'Assignment second supervisor' },
      { id: ids.member, displayName: 'Assignment member' },
      { id: ids.supB, displayName: 'Assignment supervisor B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.actorA, organizationId: ids.orgA,
        userId: ids.supA, role: 'SUPERVISOR' },
      { id: ids.actor2, organizationId: ids.orgA,
        userId: ids.sup2, role: 'SUPERVISOR' },
      { id: ids.actorMember, organizationId: ids.orgA,
        userId: ids.member, role: 'MEMBER' },
      { id: ids.actorB, organizationId: ids.orgB,
        userId: ids.supB, role: 'SUPERVISOR' },
    ]);
    await db.insert(plants).values([
      { id: ids.plantA, organizationId: ids.orgA,
        name: 'Assignment Plant A', timeZone: 'Europe/Madrid' },
      { id: ids.plantB, organizationId: ids.orgB,
        name: 'Assignment Plant B', timeZone: 'America/Bogota' },
    ]);
    await db.insert(assets).values([
      ...([ids.a, ids.b, ids.racing, ids.unassigned,
        ids.planned, ids.ordered].map((id, i) => ({
        id, organizationId: ids.orgA, code: `ASSIGN-${i}`,
        name: `Assignment equipment ${i}`,
      }))),
      { id: ids.inactive, organizationId: ids.orgA,
        code: 'ASSIGN-INACTIVE', name: 'Inactive equipment', active: false },
      { id: ids.foreign, organizationId: ids.orgB,
        code: 'ASSIGN-FOREIGN', name: 'Foreign equipment' },
    ]);
    await db.insert(maintenancePlans).values({
      organizationId: ids.orgA, assetId: ids.planned,
      createdByMembershipId: ids.actorA, title: 'Older preventive plan',
      description: 'Existing plan that must not be reinterpreted',
      intervalDays: 7, nextDueOn: '2020-01-01',
      idempotencyKey: randomUUID(), requestHash: randomUUID(),
    });
    await db.insert(workOrders).values({
      organizationId: ids.orgA, assetId: ids.ordered,
      createdByMembershipId: ids.actorA, kind: 'PREVENTIVE', incidentId: null,
      title: 'Older manual preventive',
      description: 'Existing work order must retain historical context',
      idempotencyKey: randomUUID(), requestHash: randomUUID(),
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection(); await app.init();
    sessions = app.get(SessionService);
    for (const [name, id] of Object.entries({
      supervisor: ids.supA, supervisor2: ids.sup2,
      member: ids.member, foreign: ids.supB,
    })) cookies[name] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.supA, ids.sup2, ids.member, ids.supB]) {
      await sessions?.revokeAll(id);
    }
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('links one eligible asset and exposes sanitized immutable audit', async () => {
    const response = await assign().expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ assetId: ids.a,
      plantId: ids.plantA, actorMembershipId: ids.actorA, reason });
    expect(response.body).toHaveProperty('assignedAt');
    for (const secret of ['requestHash', 'idempotencyKey',
      'transactionId', 'organizationId']) {
      expect(response.body).not.toHaveProperty(secret);
    }
    expect((await load(ids.a))?.plantId).toBe(ids.plantA);
    const reader = await request(app.getHttpServer()).get(base())
      .set('Cookie', cookies.member).expect(200);
    expect(reader.body).toMatchObject({
      id: response.body.id, plantId: ids.plantA,
    });
    await expect(db.update(assetPlantAssignments)
      .set({ reason: 'No se debe poder reescribir una auditoría' })
      .where(eq(assetPlantAssignments.assetId, ids.a)))
      .rejects.toSatisfy(sqlCode('55000'));
    await expect(db.delete(assetPlantAssignments)
      .where(eq(assetPlantAssignments.assetId, ids.a)))
      .rejects.toSatisfy(sqlCode('55000'));
  });

  it('deduplicates eight parallel identical keys and denies reassignment', async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 },
      () => assign(ids.b, ids.plantA, key)));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    await assign(ids.b, ids.plantA, key.toUpperCase()).expect(201);
    await assign(ids.b, ids.plantA, randomUUID()).expect(409);
    await assign(ids.b, ids.plantB, key).expect(409);
    expect(await audit(ids.b)).toHaveLength(1);
    await expect(db.update(assets).set({ plantId: null })
      .where(eq(assets.id, ids.b)))
      .rejects.toSatisfy(sqlCode('55000'));
    await expect(db.update(assets).set({ plantId: ids.plantB })
      .where(eq(assets.id, ids.b)))
      .rejects.toSatisfy(sqlCode('55000'));
  });

  it('serializes competing distinct keys and rejects foreign plant IDs in SQL', async () => {
    const responses = await Promise.all([
      assign(ids.racing, ids.plantA, randomUUID(), cookies.supervisor),
      assign(ids.racing, ids.plantA, randomUUID(), cookies.supervisor2),
    ]);
    expect(responses.map((res) => res.status).sort((a, b) => a - b))
      .toEqual([201, 409]);
    expect((await load(ids.racing))?.plantId).toBe(ids.plantA);
    expect(await audit(ids.racing)).toHaveLength(1);

    await assign(ids.unassigned, ids.plantB).expect(404);
    await expect(db.insert(assetPlantAssignments).values({
      organizationId: ids.orgA, assetId: ids.unassigned,
      plantId: ids.plantB, actorMembershipId: ids.actorA,
      reason, idempotencyKey: randomUUID(), requestHash: randomUUID(),
    })).rejects.toSatisfy(sqlCode('23503'));
    expect((await load(ids.unassigned))?.plantId).toBeNull();
    expect(await audit(ids.unassigned)).toHaveLength(0);
  });

  it('blocks existing plans/orders and direct SQL bypass without audit', async () => {
    await assign(ids.planned).expect(409);
    await assign(ids.ordered).expect(409);
    expect((await load(ids.planned))?.plantId).toBeNull();
    expect((await load(ids.ordered))?.plantId).toBeNull();
    await expect(db.update(assets).set({ plantId: ids.plantA })
      .where(eq(assets.id, ids.planned)))
      .rejects.toSatisfy(sqlCode('55000'));
    expect(await audit(ids.planned)).toHaveLength(0);
  });

  it('enforces tenant boundaries and active supervisor privileges', async () => {
    await assign(ids.foreign, ids.plantB).expect(404);
    await assign(ids.a, ids.plantB).expect(409);
    await assign(ids.inactive).expect(404);
    await assign(ids.a, ids.plantA, randomUUID(), cookies.member).expect(403);
    await assign(ids.a, ids.plantA, randomUUID(), cookies.foreign).expect(403);
    await assign(ids.foreign, ids.plantB, randomUUID(),
      cookies.foreign, undefined, ids.orgB).expect(201);
    await request(app.getHttpServer()).get(base(ids.orgB, ids.a))
      .set('Cookie', cookies.foreign).expect(404);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.actorA));
    try { await assign(ids.b).expect(403); }
    finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.actorA));
    }
  });

  it('validates explicit reasons, UUID keys, JSON and CSRF', async () => {
    for (const body of [
      { plantId: ids.plantA, reason: 'short' },
      { plantId: ids.plantA, reason: '😀'.repeat(5) },
      { plantId: ids.plantA, reason, active: true },
      { plantId: 'nope', reason },
      { reason }, {},
    ]) await assign(ids.planned, ids.plantA, randomUUID(),
      cookies.supervisor, body).expect(400);
    await assign(ids.planned, ids.plantA, 'bad-key').expect(400);
    await assign(ids.planned, ids.plantA, randomUUID(), '').expect(401);
    await request(app.getHttpServer()).post(base(ids.orgA, ids.planned))
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'same-origin')
      .set('Content-Type', 'text/plain').send('{}').expect(415);
    await request(app.getHttpServer()).post(base(ids.orgA, ids.planned))
      .set('Cookie', cookies.supervisor).set('Sec-Fetch-Site', 'cross-site')
      .set('Origin', 'https://attacker.invalid')
      .set('Idempotency-Key', randomUUID())
      .send({ plantId: ids.plantA, reason }).expect(403);
  });
});
