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
import { assignAssetInitialPlant } from '../src/assets/asset-plant-assignment.js';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { maintenancePlans } from '../src/database/maintenance-plans.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { plants } from '../src/database/plants.js';
import { workOrders } from '../src/database/work-orders.js';
import type { TenantContext } from '../src/security/tenant-context.js';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const target = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const pool = new Pool({ connectionString: raw, max: 16 });
const db = drizzle(pool);
const ids = {
  org: randomUUID(), foreignOrg: randomUUID(),
  supervisor: randomUUID(), member: randomUUID(), foreignSupervisor: randomUUID(),
  actor: randomUUID(), memberActor: randomUUID(), foreignActor: randomUUID(),
  madrid: randomUUID(), bogota: randomUUID(), foreignPlant: randomUUID(),
  assigned: randomUUID(), empty: randomUUID(), foreignAsset: randomUUID(),
};
const context: TenantContext = {
  organizationId: ids.org, userId: ids.supervisor,
  membershipId: ids.actor, role: 'SUPERVISOR',
};
const url = (org: string = ids.org, asset: string = ids.assigned) =>
  `/organizations/${org}/assets/${asset}/transfer-review`;

describe('Sprint 3T — transfer review without enabling transfers', () => {
  let app: INestApplication<App>;
  let sessions: SessionService;
  const cookies: Record<string, string> = {};
  const get = (query: Record<string, string> = {},
    cookie = cookies.supervisor, org = ids.org, asset = ids.assigned) => {
    const req = request(app.getHttpServer()).get(url(org, asset)).query(query);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  beforeAll(async () => {
    process.env.DATABASE_URL = raw;
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(organizations).values([
      { id: ids.org, name: 'Transfer review tenant' },
      { id: ids.foreignOrg, name: 'Transfer review foreign tenant' },
    ]);
    await db.insert(users).values([
      { id: ids.supervisor, displayName: 'Transfer supervisor' },
      { id: ids.member, displayName: 'Transfer member' },
      { id: ids.foreignSupervisor, displayName: 'Foreign supervisor' },
    ]);
    await db.insert(memberships).values([
      { id: ids.actor, organizationId: ids.org,
        userId: ids.supervisor, role: 'SUPERVISOR' },
      { id: ids.memberActor, organizationId: ids.org,
        userId: ids.member, role: 'MEMBER' },
      { id: ids.foreignActor, organizationId: ids.foreignOrg,
        userId: ids.foreignSupervisor, role: 'SUPERVISOR' },
    ]);
    await db.insert(plants).values([
      { id: ids.madrid, organizationId: ids.org,
        name: 'Madrid factory', timeZone: 'Europe/Madrid' },
      { id: ids.bogota, organizationId: ids.org,
        name: 'Bogota factory', timeZone: 'America/Bogota' },
      { id: ids.foreignPlant, organizationId: ids.foreignOrg,
        name: 'Foreign factory', timeZone: 'Asia/Kathmandu' },
    ]);
    await db.insert(assets).values([
      { id: ids.assigned, organizationId: ids.org,
        code: 'TRANSFER-1', name: 'Pump with history' },
      { id: ids.empty, organizationId: ids.org,
        code: 'TRANSFER-2', name: 'Pump without placement' },
      { id: ids.foreignAsset, organizationId: ids.foreignOrg,
        code: 'TRANSFER-3', name: 'Private foreign pump' },
    ]);
    await assignAssetInitialPlant(db, context, {
      assetId: ids.assigned, plantId: ids.madrid,
      idempotencyKey: randomUUID(),
      reason: 'Original production site verified before maintenance',
    });
    await db.insert(maintenancePlans).values([
      { organizationId: ids.org, assetId: ids.assigned,
        createdByMembershipId: ids.actor, title: 'Active maintenance plan',
        description: 'Plan with an active due date in the original zone',
        intervalDays: 1, nextDueOn: '2026-11-17',
        idempotencyKey: randomUUID(), requestHash: randomUUID() },
      { organizationId: ids.org, assetId: ids.assigned,
        createdByMembershipId: ids.actor, title: 'Paused maintenance plan',
        description: 'Plan paused but containing historical due dates',
        intervalDays: 7, nextDueOn: '2026-11-20', active: false,
        idempotencyKey: randomUUID(), requestHash: randomUUID() },
    ]);
    await db.insert(workOrders).values([
      ...(['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const)
        .map((status, index) => ({
          organizationId: ids.org, assetId: ids.assigned,
          createdByMembershipId: ids.actor, kind: 'PREVENTIVE' as const,
          status,
          ...(status === 'ASSIGNED' ? {
            responsibleMembershipId: ids.actor, assignmentVersion: 1,
          } : {}),
          title: `Order for review ${index}`,
          description: 'Original order with immutable factory context',
          idempotencyKey: randomUUID(), requestHash: randomUUID(),
        })),
      { organizationId: ids.foreignOrg, assetId: ids.foreignAsset,
        createdByMembershipId: ids.foreignActor, kind: 'PREVENTIVE',
        title: 'Foreign order', description: 'Private tenant order',
        idempotencyKey: randomUUID(), requestHash: randomUUID() },
    ]);
    await db.insert(incidents).values([
      { organizationId: ids.org, assetId: ids.assigned,
        reportedByMembershipId: ids.actor, status: 'REPORTED',
        title: 'Unresolved alert', description: 'Needs technical investigation' },
      { organizationId: ids.org, assetId: ids.assigned,
        reportedByMembershipId: ids.actor, status: 'CLOSED',
        title: 'Old alert', description: 'Already resolved historically' },
      { organizationId: ids.foreignOrg, assetId: ids.foreignAsset,
        reportedByMembershipId: ids.foreignActor, status: 'REPORTED',
        title: 'Private alert', description: 'Private external investigation' },
    ]);
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(new NodeAdapter());
    app.enableCsrfProtection(); await app.init();
    sessions = app.get(SessionService);
    for (const [name, id] of Object.entries({
      supervisor: ids.supervisor, member: ids.member,
      foreign: ids.foreignSupervisor,
    })) cookies[name] = (await sessions.create(id)).cookie;
  });
  afterAll(async () => {
    for (const id of [ids.supervisor, ids.member, ids.foreignSupervisor]) {
      await sessions?.revokeAll(id);
    }
    await app?.close(); await pool.end(); delete process.env.DATABASE_URL;
  });

  it('summarizes all business impact without asserting transfer eligibility', async () => {
    const response = await get({ targetPlantId: ids.bogota }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      policyStatus: 'UNDECIDED',
      transferAuthorized: false,
      asset: { id: ids.assigned, active: true, plantId: ids.madrid },
      currentPlant: { id: ids.madrid, timeZone: 'Europe/Madrid' },
      targetPlant: { id: ids.bogota, timeZone: 'America/Bogota' },
      samePlant: false,
      impact: {
        activePlans: 1, pausedPlans: 1,
        openOrders: 3, completedOrders: 1, cancelledOrders: 1,
        ordersWithoutPlantSnapshot: 0,
        ordersWithUnknownHistoricalLocation: 0,
        unresolvedIncidents: 1, closedIncidents: 1,
      },
    });
    expect(response.body).not.toHaveProperty('approved');
    expect(response.body).not.toHaveProperty('canTransfer');
    const before = await db.select().from(assets)
      .where(eq(assets.id, ids.assigned));
    expect(before[0]?.plantId).toBe(ids.madrid);
  });

  it('never authorizes transfers for empty or same-plant assets', async () => {
    const empty = await get({}, cookies.supervisor, ids.org, ids.empty).expect(200);
    expect(empty.body).toMatchObject({
      transferAuthorized: false, policyStatus: 'UNDECIDED',
      currentPlant: null, targetPlant: null,
      impact: {
        activePlans: 0, pausedPlans: 0, openOrders: 0,
        completedOrders: 0, cancelledOrders: 0,
        unresolvedIncidents: 0, closedIncidents: 0,
      },
    });
    const same = await get({ targetPlantId: ids.madrid }).expect(200);
    expect(same.body).toMatchObject({
      transferAuthorized: false, samePlant: true,
    });
  });

  it('does not disclose another tenant assets, plants or counts', async () => {
    await get({ targetPlantId: ids.foreignPlant }).expect(404);
    await get({}, cookies.supervisor, ids.org, ids.foreignAsset).expect(404);
    await get({}, cookies.foreign, ids.foreignOrg, ids.assigned).expect(404);
    await get({}, cookies.foreign, ids.org).expect(403);
    const foreign = await get({}, cookies.foreign, ids.foreignOrg,
      ids.foreignAsset).expect(200);
    expect(foreign.body.impact.openOrders).toBe(1);
    expect(foreign.body.impact.unresolvedIncidents).toBe(1);
  });

  it('restricts operational review to active supervisors', async () => {
    await get({}, '').expect(401);
    await get({}, cookies.member).expect(403);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.actor));
    try { await get().expect(403); }
    finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.actor));
    }
  });

  it('validates the target query and resource UUIDs', async () => {
    await get({ targetPlantId: 'invalid' }).expect(400);
    await request(app.getHttpServer()).get(url()).query({
      targetPlantId: [ids.madrid, ids.bogota],
    }).set('Cookie', cookies.supervisor).expect(400);
    await request(app.getHttpServer()).get(url(ids.org, 'invalid'))
      .set('Cookie', cookies.supervisor).expect(400);
    await get({}, cookies.supervisor, ids.org, randomUUID()).expect(404);
  });
});
