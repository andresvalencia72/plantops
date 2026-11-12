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
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrderCancellations } from '../src/database/work-order-cancellations.js';
import { workOrders } from '../src/database/work-orders.js';
import { createCorrectiveOrder } from '../src/work-orders/create-corrective-order.js';
import { assignTechnician } from '../src/work-orders/assign-technician.js';
import { executeWorkOrder } from '../src/work-orders/execute-work-order.js';
import { cancelWorkOrder } from '../src/work-orders/cancel-work-order.js';
import { DrizzleCancellationReader } from '../src/work-orders/drizzle-cancellation-reader.js';
import { DrizzleMembershipLookup } from '../src/security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../src/security/tenant-context.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Only loopback *_test');
const pool = new Pool({ connectionString: url, max: 20 });
const db = drizzle(pool);
const lookup = new DrizzleMembershipLookup(db);
const reader = new DrizzleCancellationReader(db);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  supA: randomUUID(), supB: randomUUID(), techA: randomUUID(), memberA: randomUUID(),
  msA: randomUUID(), msB: randomUUID(), mtA: randomUUID(), mmA: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
};
const context = (user: string, org = ids.orgA) => resolveTenantContext(
  { userId: user } as VerifiedSessionIdentity, org, lookup);
const reason = 'Reparación innecesaria: el equipo ya fue sustituido durante mantenimiento';
async function fixture() {
  const [incident] = await db.insert(incidents).values({
    organizationId: ids.orgA, assetId: ids.assetA,
    reportedByMembershipId: ids.msA, status: 'UNDER_REVIEW',
    title: 'UC07 incident', description: 'Synthetic equipment failure',
  }).returning({ id: incidents.id });
  const incidentId = incident!.id;
  const order = await createCorrectiveOrder(db, await context(ids.supA), {
    incidentId, idempotencyKey: randomUUID(),
    title: 'Repair test bearing', description: 'Replace test motor bearing',
  });
  return { incidentId, orderId: order.id };
}
function body(order: { incidentId: string; orderId: string }, key = randomUUID()) {
  return { ...order, reason, idempotencyKey: key };
}
async function assign(order: { incidentId: string; orderId: string }) {
  await assignTechnician(db, await context(ids.supA), {
    ...order, technicianMembershipId: ids.mtA,
    expectedVersion: 0, idempotencyKey: randomUUID(),
  });
}
async function start(order: { incidentId: string; orderId: string }) {
  await executeWorkOrder(db, await context(ids.techA), {
    ...order, idempotencyKey: randomUUID(), action: 'STARTED',
  });
}
async function status(id: string) {
  return (await db.select({ status: workOrders.status })
    .from(workOrders).where(eq(workOrders.id, id)))[0]?.status;
}
async function audit(id: string) {
  return db.select().from(workOrderCancellations)
    .where(eq(workOrderCancellations.workOrderId, id));
}

describe('UC-07 cancellation with real PostgreSQL', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      ids.supA, ids.supB, ids.techA, ids.memberA,
    ].map((id) => ({ id, displayName: 'UC07 synthetic ' + id.slice(0, 4) })));
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'UC07 Plant A' },
      { id: ids.orgB, name: 'UC07 Plant B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.msA, organizationId: ids.orgA,
        userId: ids.supA, role: 'SUPERVISOR' },
      { id: ids.mtA, organizationId: ids.orgA,
        userId: ids.techA, role: 'TECHNICIAN' },
      { id: ids.mmA, organizationId: ids.orgA,
        userId: ids.memberA, role: 'MEMBER' },
      { id: ids.msB, organizationId: ids.orgB,
        userId: ids.supB, role: 'SUPERVISOR' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'UC07A', name: 'Pump' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'UC07B', name: 'Pump' },
    ]);
  });
  afterAll(async () => { await pool.end(); });

  it('cancels PENDING with explicit reason, preserves immutable evidence', async () => {
    const order = await fixture();
    const supervisor = await context(ids.supA);
    const event = await cancelWorkOrder(db, supervisor, body(order));
    expect(event).toMatchObject({ workOrderId: order.orderId,
      actorMembershipId: ids.msA, fromStatus: 'PENDING', reason });
    expect(event).not.toHaveProperty('requestHash');
    expect(event).not.toHaveProperty('idempotencyKey');
    expect(await status(order.orderId)).toBe('CANCELLED');
    const read = await reader.find(supervisor, order.incidentId, order.orderId);
    expect(read).toEqual(event);
    await expect(db.update(workOrderCancellations).set({ reason: 'tampered' })
      .where(eq(workOrderCancellations.id, event.id))).rejects.toThrow();
    await expect(db.delete(workOrderCancellations)
      .where(eq(workOrderCancellations.id, event.id))).rejects.toThrow();
    expect(await audit(order.orderId)).toHaveLength(1);
  });

  it('cancels ASSIGNED and IN_PROGRESS, never COMPLETED or already CANCELLED', async () => {
    const assigned = await fixture();
    await assign(assigned);
    expect((await cancelWorkOrder(db, await context(ids.supA),
      body(assigned))).fromStatus).toBe('ASSIGNED');
    await expect(executeWorkOrder(db, await context(ids.techA), {
      ...assigned, idempotencyKey: randomUUID(), action: 'STARTED',
    })).rejects.toThrow(ConflictException);
    const inProgress = await fixture();
    await assign(inProgress);
    await start(inProgress);
    expect((await cancelWorkOrder(db, await context(ids.supA),
      body(inProgress))).fromStatus).toBe('IN_PROGRESS');
    await expect(executeWorkOrder(db, await context(ids.techA), {
      ...inProgress, idempotencyKey: randomUUID(), action: 'COMPLETED',
      result: 'Replaced shaft and validated the vibration',
    })).rejects.toThrow(ConflictException);
    const complete = await fixture();
    await assign(complete); await start(complete);
    await executeWorkOrder(db, await context(ids.techA), {
      ...complete, idempotencyKey: randomUUID(), action: 'COMPLETED',
      result: 'Replaced shaft and validated the vibration',
    });
    await expect(cancelWorkOrder(db, await context(ids.supA),
      body(complete))).rejects.toThrow(ConflictException);
    await expect(cancelWorkOrder(db, await context(ids.supA),
      body(assigned))).rejects.toThrow(ConflictException);
    expect(await audit(assigned.orderId)).toHaveLength(1);
  });

  it('replays original 201 with identical key, rejects different reason', async () => {
    const order = await fixture();
    const data = body(order);
    const supervisor = await context(ids.supA);
    const first = await cancelWorkOrder(db, supervisor, data);
    expect(await cancelWorkOrder(db, supervisor, {
      ...data, idempotencyKey: data.idempotencyKey.toUpperCase(),
    })).toEqual(first);
    await expect(cancelWorkOrder(db, supervisor, {
      ...data, reason: 'Other reason for the cancellation',
    })).rejects.toThrow(ConflictException);
    expect(await audit(order.orderId)).toHaveLength(1);
  });

  it('denies member/technician, stale supervisor, foreign tenant and malformed payload', async () => {
    const order = await fixture();
    for (const user of [ids.memberA, ids.techA]) {
      await expect(cancelWorkOrder(db, await context(user), body(order)))
        .rejects.toThrow(ForbiddenException);
    }
    await expect(cancelWorkOrder(db, await context(ids.supB, ids.orgB),
      body(order))).rejects.toThrow(NotFoundException);
    await expect(reader.find(await context(ids.supB, ids.orgB),
      order.incidentId, order.orderId)).rejects.toThrow(NotFoundException);
    const supervisor = await context(ids.supA);
    for (const invalid of [{ reason: 'short' }, { reason: 'Z'.repeat(1001) },
      { idempotencyKey: 'not-uuid' }, { orderId: 'invalid' }]) {
      await expect(cancelWorkOrder(db, supervisor, {
        ...body(order), ...invalid,
      })).rejects.toThrow(BadRequestException);
    }
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.msA));
    try {
      await expect(cancelWorkOrder(db, { organizationId: ids.orgA,
        membershipId: ids.msA, userId: ids.supA, role: 'SUPERVISOR',
      }, body(order))).rejects.toThrow(ForbiddenException);
    } finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.msA));
    }
    expect(await status(order.orderId)).toBe('PENDING');
  });

  it('serializes cancellation vs completion: no double terminal transition', async () => {
    const order = await fixture();
    await assign(order); await start(order);
    const supervisor = await context(ids.supA);
    const technician = await context(ids.techA);
    const simultaneous = await Promise.allSettled([
      cancelWorkOrder(db, supervisor, body(order)),
      executeWorkOrder(db, technician, { ...order, action: 'COMPLETED',
        result: 'Completed the intervention and checked all components',
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(simultaneous.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const current = await status(order.orderId);
    expect(['CANCELLED', 'COMPLETED']).toContain(current);
    expect(await audit(order.orderId)).toHaveLength(current === 'CANCELLED' ? 1 : 0);
  });

  it('12 identical concurrent cancellations produce one event', async () => {
    const order = await fixture();
    const supervisor = await context(ids.supA);
    const same = body(order);
    const results = await Promise.all(Array.from({ length: 12 }, () =>
      cancelWorkOrder(db, supervisor, same)));
    expect(new Set(results.map((event) => event.id)).size).toBe(1);
    expect(await audit(order.orderId)).toHaveLength(1);
  });

  it('audit insert failure rolls back CANCELLED status', async () => {
    const order = await fixture();
    await db.execute(sql`CREATE FUNCTION uc07_reject_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'failed audit'; END; $$`);
    await db.execute(sql`CREATE TRIGGER uc07_reject_insert_trigger
      BEFORE INSERT ON work_order_cancellations
      FOR EACH ROW EXECUTE FUNCTION uc07_reject_insert()`);
    try {
      await expect(cancelWorkOrder(db, await context(ids.supA), body(order)))
        .rejects.toThrow();
      expect(await status(order.orderId)).toBe('PENDING');
      expect(await audit(order.orderId)).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER uc07_reject_insert_trigger
        ON work_order_cancellations`);
      await db.execute(sql`DROP FUNCTION uc07_reject_insert()`);
    }
  });
});
