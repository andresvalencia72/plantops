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
import { workOrderExecutions } from '../src/database/work-order-executions.js';
import { workOrders } from '../src/database/work-orders.js';
import { createCorrectiveOrder } from '../src/work-orders/create-corrective-order.js';
import { assignTechnician } from '../src/work-orders/assign-technician.js';
import { executeWorkOrder } from '../src/work-orders/execute-work-order.js';
import { DrizzleExecutionReader } from '../src/work-orders/drizzle-execution-reader.js';
import { DrizzleMembershipLookup } from '../src/security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../src/security/tenant-context.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) throw new Error('Disposable loopback test DB only');
const pool = new Pool({ connectionString: url, max: 24 });
const db = drizzle(pool);
const lookup = new DrizzleMembershipLookup(db);
const reader = new DrizzleExecutionReader(db);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  sup: randomUUID(), techA: randomUUID(), tech2: randomUUID(),
  techB: randomUUID(), member: randomUUID(),
  ms: randomUUID(), ma: randomUUID(), mt: randomUUID(),
  mt2: randomUUID(), mb: randomUUID(), assetA: randomUUID(), assetB: randomUUID(),
};
const ctx = async (user: string, org = ids.orgA) => resolveTenantContext(
  { userId: user } as VerifiedSessionIdentity, org, lookup);
async function fixture(assigned = true) {
  const [incident] = await db.insert(incidents).values({
    organizationId: ids.orgA, assetId: ids.assetA,
    reportedByMembershipId: ids.ms, status: 'UNDER_REVIEW',
    title: 'UC06 test incident', description: 'Synthetic equipment failure',
  }).returning({ id: incidents.id });
  const incidentId = incident!.id;
  const order = await createCorrectiveOrder(db, await ctx(ids.sup), {
    incidentId, idempotencyKey: randomUUID(),
    title: 'Repair synthetic bearing',
    description: 'Repair the synthetic main shaft bearing',
  });
  if (assigned) await assignTechnician(db, await ctx(ids.sup), {
    incidentId, orderId: order.id, technicianMembershipId: ids.mt,
    expectedVersion: 0, idempotencyKey: randomUUID(),
  });
  return { incidentId, orderId: order.id };
}
function cmd(idsOfOrder: { incidentId: string; orderId: string },
  action: 'STARTED' | 'COMPLETED', idempotencyKey = randomUUID(),
  result = 'Replaced bearing, inspected shaft and verified motor') {
  return { ...idsOfOrder, action, idempotencyKey,
    ...(action === 'COMPLETED' ? { result } : {}) };
}
async function status(id: string) {
  return (await db.select({ status: workOrders.status,
    responsible: workOrders.responsibleMembershipId,
    version: workOrders.assignmentVersion,
  }).from(workOrders).where(eq(workOrders.id, id)))[0];
}
async function audit(id: string) {
  return db.select().from(workOrderExecutions)
    .where(eq(workOrderExecutions.workOrderId, id));
}

describe('UC-06 — real PostgreSQL execution, current technician only', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      ids.sup, ids.techA, ids.tech2, ids.techB, ids.member,
    ].map((id) => ({ id, displayName: 'UC06 synthetic ' + id.slice(0, 5) })));
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'UC06 A' }, { id: ids.orgB, name: 'UC06 B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.ms, organizationId: ids.orgA, userId: ids.sup, role: 'SUPERVISOR' },
      { id: ids.mt, organizationId: ids.orgA, userId: ids.techA, role: 'TECHNICIAN' },
      { id: ids.mt2, organizationId: ids.orgA, userId: ids.tech2, role: 'TECHNICIAN' },
      { id: ids.ma, organizationId: ids.orgA, userId: ids.member, role: 'MEMBER' },
      { id: ids.mb, organizationId: ids.orgB, userId: ids.techB, role: 'TECHNICIAN' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'UC06A', name: 'A' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'UC06B', name: 'B' },
    ]);
  });
  afterAll(async () => { await pool.end(); });

  it('start then complete: two immutable events, one current responsible', async () => {
    const idsOfOrder = await fixture();
    const tech = await ctx(ids.techA);
    const start = await executeWorkOrder(db, tech, cmd(idsOfOrder, 'STARTED'));
    expect(start).toMatchObject({ action: 'STARTED', fromStatus: 'ASSIGNED',
      toStatus: 'IN_PROGRESS', result: null, actorMembershipId: ids.mt });
    expect(start).not.toHaveProperty('idempotencyKey');
    expect(start).not.toHaveProperty('requestHash');
    expect(await status(idsOfOrder.orderId)).toEqual({ status: 'IN_PROGRESS',
      responsible: ids.mt, version: 1 });
    const complete = await executeWorkOrder(db, tech,
      cmd(idsOfOrder, 'COMPLETED'));
    expect(complete).toMatchObject({ action: 'COMPLETED',
      fromStatus: 'IN_PROGRESS', toStatus: 'COMPLETED',
      result: 'Replaced bearing, inspected shaft and verified motor' });
    expect(await status(idsOfOrder.orderId)).toMatchObject({ status: 'COMPLETED' });
    const history = await reader.list(tech, idsOfOrder.incidentId, idsOfOrder.orderId);
    expect(history).toHaveLength(2);
    expect(history.map((e) => e.action)).toEqual(['STARTED', 'COMPLETED']);
    expect(history[1]).not.toHaveProperty('requestHash');
    await expect(db.update(workOrderExecutions).set({ result: 'tampered' })
      .where(eq(workOrderExecutions.id, start.id))).rejects.toThrow();
    await expect(db.delete(workOrderExecutions)
      .where(eq(workOrderExecutions.id, start.id))).rejects.toThrow();
    expect(await audit(idsOfOrder.orderId)).toHaveLength(2);
  });

  it('rejects unassigned order, finish-before-start, duplicate action and short result', async () => {
    const unassigned = await fixture(false);
    const tech = await ctx(ids.techA);
    await expect(executeWorkOrder(db, tech, cmd(unassigned, 'STARTED')))
      .rejects.toThrow(ForbiddenException);
    const order = await fixture();
    await expect(executeWorkOrder(db, tech, cmd(order, 'COMPLETED')))
      .rejects.toThrow(ConflictException);
    await expect(executeWorkOrder(db, tech,
      cmd(order, 'COMPLETED', randomUUID(), 'short')))
      .rejects.toThrow(BadRequestException);
    await executeWorkOrder(db, tech, cmd(order, 'STARTED'));
    await expect(executeWorkOrder(db, tech, cmd(order, 'STARTED')))
      .rejects.toThrow(ConflictException);
    expect(await audit(order.orderId)).toHaveLength(1);
  });

  it('same-key replay is idempotent after completion; mismatching content conflicts', async () => {
    const order = await fixture();
    const tech = await ctx(ids.techA);
    const start = cmd(order, 'STARTED');
    const original = await executeWorkOrder(db, tech, start);
    const complete = cmd(order, 'COMPLETED');
    const finish = await executeWorkOrder(db, tech, complete);
    expect(await executeWorkOrder(db, tech, start)).toEqual(original);
    expect(await executeWorkOrder(db, tech, complete)).toEqual(finish);
    await expect(executeWorkOrder(db, tech, {
      ...complete, result: 'Replaced a completely different component',
    })).rejects.toThrow(ConflictException);
    await expect(executeWorkOrder(db, tech, { ...start, orderId: randomUUID() }))
      .rejects.toThrow(NotFoundException);
    expect(await audit(order.orderId)).toHaveLength(2);
  });

  it('rejects member, supervisor, previous technician, suspended technician, foreign scope', async () => {
    const order = await fixture();
    for (const user of [ids.sup, ids.member, ids.tech2]) {
      await expect(executeWorkOrder(db, await ctx(user), cmd(order, 'STARTED')))
        .rejects.toThrow(ForbiddenException);
    }
    await expect(executeWorkOrder(db, await ctx(ids.techA),
      cmd({ ...order, incidentId: randomUUID() }, 'STARTED')))
      .rejects.toThrow(NotFoundException);
    await expect(reader.list(await ctx(ids.techB, ids.orgB),
      order.incidentId, order.orderId)).rejects.toThrow(NotFoundException);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.mt));
    try {
      await expect(executeWorkOrder(db, await ctx(ids.sup),
        cmd(order, 'STARTED'))).rejects.toThrow(ForbiddenException);
      // Resolve checks ACTIVE, so mimic a stale context to recheck within tx.
      await expect(executeWorkOrder(db, {
        organizationId: ids.orgA, userId: ids.techA,
        membershipId: ids.mt, role: 'TECHNICIAN',
      }, cmd(order, 'STARTED'))).rejects.toThrow(ForbiddenException);
    } finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.mt));
    }
  });

  it('old technician loses authority after reassignment; only current technician starts', async () => {
    const order = await fixture();
    await assignTechnician(db, await ctx(ids.sup), {
      ...order, technicianMembershipId: ids.mt2,
      expectedVersion: 1, idempotencyKey: randomUUID(),
    });
    await expect(executeWorkOrder(db, await ctx(ids.techA),
      cmd(order, 'STARTED'))).rejects.toThrow(ForbiddenException);
    await executeWorkOrder(db, await ctx(ids.tech2), cmd(order, 'STARTED'));
    expect((await status(order.orderId))?.responsible).toBe(ids.mt2);
    await expect(assignTechnician(db, await ctx(ids.sup), {
      ...order, technicianMembershipId: ids.mt,
      expectedVersion: 2, idempotencyKey: randomUUID(),
    })).rejects.toThrow(ConflictException);
  });

  it('serializes racing reassignment vs start: exactly one wins the same order', async () => {
    const order = await fixture();
    const supervisor = await ctx(ids.sup);
    const technician = await ctx(ids.techA);
    const attempts = await Promise.allSettled([
      assignTechnician(db, supervisor, { ...order,
        technicianMembershipId: ids.mt2, expectedVersion: 1,
        idempotencyKey: randomUUID() }),
      executeWorkOrder(db, technician, cmd(order, 'STARTED')),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const current = await status(order.orderId);
    expect(['ASSIGNED', 'IN_PROGRESS']).toContain(current?.status);
    if (current?.status === 'ASSIGNED') {
      expect(current.responsible).toBe(ids.mt2);
      expect(await audit(order.orderId)).toHaveLength(0);
    } else {
      expect(current?.responsible).toBe(ids.mt);
      expect(await audit(order.orderId)).toHaveLength(1);
    }
  });

  it('concurrent exact retries produce one start and one completion', async () => {
    const order = await fixture();
    const tech = await ctx(ids.techA);
    const sameStart = cmd(order, 'STARTED');
    const starts = await Promise.all(Array.from({ length: 12 }, () =>
      executeWorkOrder(db, tech, sameStart)));
    expect(new Set(starts.map((event) => event.id)).size).toBe(1);
    const sameComplete = cmd(order, 'COMPLETED');
    const finishes = await Promise.all(Array.from({ length: 12 }, () =>
      executeWorkOrder(db, tech, sameComplete)));
    expect(new Set(finishes.map((event) => event.id)).size).toBe(1);
    expect(await audit(order.orderId)).toHaveLength(2);
  });

  it('failed audit insertion rolls back order status', async () => {
    const order = await fixture();
    await db.execute(sql`CREATE FUNCTION uc06_reject_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END; $$`);
    await db.execute(sql`CREATE TRIGGER uc06_reject_audit_trigger
      BEFORE INSERT ON work_order_executions
      FOR EACH ROW EXECUTE FUNCTION uc06_reject_audit()`);
    try {
      await expect(executeWorkOrder(db, await ctx(ids.techA),
        cmd(order, 'STARTED'))).rejects.toThrow();
      expect((await status(order.orderId))?.status).toBe('ASSIGNED');
      expect(await audit(order.orderId)).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER uc06_reject_audit_trigger
        ON work_order_executions`);
      await db.execute(sql`DROP FUNCTION uc06_reject_audit()`);
    }
  });
});
