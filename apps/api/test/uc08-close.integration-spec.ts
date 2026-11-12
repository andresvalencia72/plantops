import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { incidentClosures } from '../src/database/incident-closures.js';
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrders } from '../src/database/work-orders.js';
import { createCorrectiveOrder } from '../src/work-orders/create-corrective-order.js';
import { assignTechnician } from '../src/work-orders/assign-technician.js';
import { executeWorkOrder } from '../src/work-orders/execute-work-order.js';
import { cancelWorkOrder } from '../src/work-orders/cancel-work-order.js';
import { closeIncident } from '../src/incidents/close-incident.js';
import { DrizzleClosureReader } from '../src/incidents/drizzle-closure-reader.js';
import { DrizzleMembershipLookup } from '../src/security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../src/security/tenant-context.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const address = new URL(url);
if (!['localhost', '127.0.0.1'].includes(address.hostname) ||
  !address.pathname.endsWith('_test')) throw new Error('Only loopback test DB');
const pool = new Pool({ connectionString: url, max: 28 });
const db = drizzle(pool);
const lookup = new DrizzleMembershipLookup(db);
const reader = new DrizzleClosureReader(db);
const ids = { org: randomUUID(), foreignOrg: randomUUID(),
  sup: randomUUID(), tech: randomUUID(), member: randomUUID(), foreign: randomUUID(),
  ms: randomUUID(), mt: randomUUID(), mm: randomUUID(), mf: randomUUID(),
  asset: randomUUID(), foreignAsset: randomUUID() };
const reason = 'Se ha verificado la intervención y no queda trabajo pendiente en el equipo';
const conclusion = 'El activo se encuentra estable, revisado y listo para operar con normalidad';
const context = (user: string, org = ids.org) => resolveTenantContext(
  { userId: user } as VerifiedSessionIdentity, org, lookup);
async function makeIncident(status: 'UNDER_REVIEW' | 'REPORTED' = 'UNDER_REVIEW') {
  const [row] = await db.insert(incidents).values({
    organizationId: ids.org, assetId: ids.asset,
    reportedByMembershipId: ids.ms, status,
    title: 'UC08 test incident', description: 'Synthetic closure incident',
  }).returning({ id: incidents.id });
  return row!.id;
}
async function makeOrder(incidentId: string) {
  return createCorrectiveOrder(db, await context(ids.sup), {
    incidentId, idempotencyKey: randomUUID(),
    title: 'Inspect synthetic machine',
    description: 'Inspect the mechanical equipment and report observations',
  });
}
async function assignAndComplete(incidentId: string, orderId: string) {
  await assignTechnician(db, await context(ids.sup), { incidentId, orderId,
    technicianMembershipId: ids.mt, expectedVersion: 0, idempotencyKey: randomUUID() });
  await executeWorkOrder(db, await context(ids.tech), { incidentId, orderId,
    action: 'STARTED', idempotencyKey: randomUUID() });
  await executeWorkOrder(db, await context(ids.tech), { incidentId, orderId,
    action: 'COMPLETED', idempotencyKey: randomUUID(),
    result: 'Replaced bearing and checked operational safety',
  });
}
function input(incidentId: string, withConclusion = false,
  key = randomUUID()) {
  return { incidentId, idempotencyKey: key, reason,
    ...(withConclusion ? { conclusion } : {}) };
}
async function status(id: string) {
  return (await db.select({ status: incidents.status }).from(incidents)
    .where(eq(incidents.id, id)))[0]?.status;
}
async function orders(incidentId: string) {
  return db.select({ status: workOrders.status }).from(workOrders)
    .where(eq(workOrders.incidentId, incidentId));
}
async function events(incidentId: string) {
  return db.select().from(incidentClosures)
    .where(eq(incidentClosures.incidentId, incidentId));
}

describe('UC-08 — close incident atomically against creating new orders', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      ids.sup, ids.tech, ids.member, ids.foreign,
    ].map((id) => ({ id, displayName: 'UC08 synthetic ' + id.slice(0, 5) })));
    await db.insert(organizations).values([
      { id: ids.org, name: 'UC08 A' },
      { id: ids.foreignOrg, name: 'UC08 B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.ms, organizationId: ids.org, userId: ids.sup, role: 'SUPERVISOR' },
      { id: ids.mt, organizationId: ids.org, userId: ids.tech, role: 'TECHNICIAN' },
      { id: ids.mm, organizationId: ids.org, userId: ids.member, role: 'MEMBER' },
      { id: ids.mf, organizationId: ids.foreignOrg,
        userId: ids.foreign, role: 'SUPERVISOR' },
    ]);
    await db.insert(assets).values([
      { id: ids.asset, organizationId: ids.org, code: 'UC08-A', name: 'A' },
      { id: ids.foreignAsset, organizationId: ids.foreignOrg,
        code: 'UC08-B', name: 'B' },
    ]);
  });
  afterAll(async () => { await pool.end(); });

  it('supervisor closes UNDER_REVIEW without orders using reason only', async () => {
    const incidentId = await makeIncident();
    const supervisor = await context(ids.sup);
    const data = input(incidentId);
    const closed = await closeIncident(db, supervisor, data);
    expect(closed).toMatchObject({ incidentId, fromStatus: 'UNDER_REVIEW',
      reason, conclusion: null, orderCount: 0,
      completedCount: 0, cancelledCount: 0 });
    expect(closed).not.toHaveProperty('requestHash');
    expect(closed).not.toHaveProperty('idempotencyKey');
    expect(await status(incidentId)).toBe('CLOSED');
    expect(await closeIncident(db, supervisor, data)).toEqual(closed);
    const visible = await reader.read(await context(ids.member), incidentId);
    expect(visible).toMatchObject({ status: 'CLOSED',
      orders: { total: 0, completed: 0, cancelled: 0, open: 0 },
      closure: closed });
    await expect(db.update(incidentClosures).set({ reason: 'tampered' })
      .where(eq(incidentClosures.id, closed.id))).rejects.toThrow();
    await expect(db.delete(incidentClosures)
      .where(eq(incidentClosures.id, closed.id))).rejects.toThrow();
  });

  it('rejects REPORTED, insufficient reason, and extra conclusion without orders', async () => {
    const reported = await makeIncident('REPORTED');
    const reviewed = await makeIncident();
    const supervisor = await context(ids.sup);
    await expect(closeIncident(db, supervisor, input(reported)))
      .rejects.toThrow(ConflictException);
    await expect(closeIncident(db, supervisor, {
      ...input(reviewed), reason: 'short',
    })).rejects.toThrow(BadRequestException);
    await expect(closeIncident(db, supervisor,
      input(reviewed, true))).rejects.toThrow(ConflictException);
    expect(await status(reviewed)).toBe('UNDER_REVIEW');
  });

  it('closes when every linked order is COMPLETED or CANCELLED, with conclusion', async () => {
    const incidentId = await makeIncident();
    const done = await makeOrder(incidentId);
    const cancelled = await makeOrder(incidentId);
    await assignAndComplete(incidentId, done.id);
    await cancelWorkOrder(db, await context(ids.sup), { incidentId,
      orderId: cancelled.id, reason: 'Cancellation because the repair was redundant',
      idempotencyKey: randomUUID(),
    });
    const closed = await closeIncident(db, await context(ids.sup),
      input(incidentId, true));
    expect(closed).toMatchObject({ incidentId, fromStatus: 'IN_PROGRESS',
      reason, conclusion, orderCount: 2, completedCount: 1, cancelledCount: 1 });
    expect(await status(incidentId)).toBe('CLOSED');
    await expect(makeOrder(incidentId)).rejects.toThrow(ConflictException);
    expect(await events(incidentId)).toHaveLength(1);
  });

  it('blocks PENDING, ASSIGNED, IN_PROGRESS orders until all terminal', async () => {
    const incidentId = await makeIncident();
    const order = await makeOrder(incidentId);
    const supervisor = await context(ids.sup);
    await expect(closeIncident(db, supervisor, input(incidentId, true)))
      .rejects.toThrow(ConflictException);
    await assignTechnician(db, supervisor, { incidentId, orderId: order.id,
      technicianMembershipId: ids.mt, expectedVersion: 0, idempotencyKey: randomUUID() });
    await expect(closeIncident(db, supervisor, input(incidentId, true)))
      .rejects.toThrow(ConflictException);
    await executeWorkOrder(db, await context(ids.tech), { incidentId,
      orderId: order.id, action: 'STARTED', idempotencyKey: randomUUID() });
    await expect(closeIncident(db, supervisor, input(incidentId, true)))
      .rejects.toThrow(ConflictException);
    await executeWorkOrder(db, await context(ids.tech), { incidentId,
      orderId: order.id, action: 'COMPLETED', idempotencyKey: randomUUID(),
      result: 'Repaired bearing and validated equipment safety',
    });
    await expect(closeIncident(db, supervisor, input(incidentId)))
      .rejects.toThrow(ConflictException);
    await closeIncident(db, supervisor, input(incidentId, true));
    expect(await status(incidentId)).toBe('CLOSED');
  });

  it('denies member/technician, foreign and suspended supervisor', async () => {
    const incidentId = await makeIncident();
    for (const user of [ids.member, ids.tech]) {
      await expect(closeIncident(db, await context(user), input(incidentId)))
        .rejects.toThrow(ForbiddenException);
    }
    await expect(closeIncident(db, await context(ids.foreign, ids.foreignOrg),
      input(incidentId))).rejects.toThrow(NotFoundException);
    await expect(reader.read(await context(ids.foreign, ids.foreignOrg),
      incidentId)).rejects.toThrow(NotFoundException);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.ms));
    try {
      await expect(closeIncident(db, {
        userId: ids.sup, membershipId: ids.ms,
        organizationId: ids.org, role: 'SUPERVISOR',
      }, input(incidentId))).rejects.toThrow(ForbiddenException);
    } finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.ms));
    }
  });

  it('race with create from UNDER_REVIEW: only close or new order can win', async () => {
    const incidentId = await makeIncident();
    const supervisor = await context(ids.sup);
    const results = await Promise.allSettled([
      closeIncident(db, supervisor, input(incidentId)),
      makeOrder(incidentId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = await status(incidentId);
    const linked = await orders(incidentId);
    if (current === 'CLOSED') {
      expect(linked).toHaveLength(0);
      expect(await events(incidentId)).toHaveLength(1);
    } else {
      expect(current).toBe('IN_PROGRESS');
      expect(linked.map((o) => o.status)).toEqual(['PENDING']);
      expect(await events(incidentId)).toHaveLength(0);
    }
  });

  it('race with new order after other terminal OT also excludes unsafe closure', async () => {
    const incidentId = await makeIncident();
    const first = await makeOrder(incidentId);
    await cancelWorkOrder(db, await context(ids.sup), { incidentId,
      orderId: first.id, reason: 'Not necessary because equipment was replaced',
      idempotencyKey: randomUUID(),
    });
    const supervisor = await context(ids.sup);
    const results = await Promise.allSettled([
      closeIncident(db, supervisor, input(incidentId, true)),
      makeOrder(incidentId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = await status(incidentId);
    const linked = await orders(incidentId);
    if (current === 'CLOSED') {
      expect(linked.map((o) => o.status)).toEqual(['CANCELLED']);
    } else {
      expect(current).toBe('IN_PROGRESS');
      expect(linked.map((o) => o.status).sort()).toEqual(['CANCELLED', 'PENDING']);
    }
  });

  it('exact same-key retries 12× return one event, changed content rejects', async () => {
    const incidentId = await makeIncident();
    const supervisor = await context(ids.sup);
    const data = input(incidentId);
    const results = await Promise.all(Array.from({ length: 12 }, () =>
      closeIncident(db, supervisor, data)));
    expect(new Set(results.map((item) => item.id)).size).toBe(1);
    expect(await events(incidentId)).toHaveLength(1);
    await expect(closeIncident(db, supervisor, {
      ...data, reason: 'A different reason attempted after the first close',
    })).rejects.toThrow(ConflictException);
  });

  it('audit failure rolls back status, leaving incident eligible for retry', async () => {
    const incidentId = await makeIncident();
    await db.execute(sql`CREATE FUNCTION uc08_reject_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failed'; END; $$`);
    await db.execute(sql`CREATE TRIGGER uc08_reject_insert_trigger
      BEFORE INSERT ON incident_closures
      FOR EACH ROW EXECUTE FUNCTION uc08_reject_insert()`);
    try {
      await expect(closeIncident(db, await context(ids.sup), input(incidentId)))
        .rejects.toThrow();
      expect(await status(incidentId)).toBe('UNDER_REVIEW');
      expect(await events(incidentId)).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER uc08_reject_insert_trigger ON incident_closures`);
      await db.execute(sql`DROP FUNCTION uc08_reject_insert()`);
    }
  });
});
