import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BadRequestException, ConflictException, ForbiddenException,
  NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrderAssignments } from '../src/database/work-order-assignments.js';
import { workOrders } from '../src/database/work-orders.js';
import { createCorrectiveOrder } from '../src/work-orders/create-corrective-order.js';
import { assignTechnician } from '../src/work-orders/assign-technician.js';
import { DrizzleAssignmentReader } from '../src/work-orders/drizzle-assignment-reader.js';
import { DrizzleMembershipLookup } from '../src/security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../src/security/tenant-context.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) throw new Error('Disposable loopback test DB only');
const pool = new Pool({ connectionString: url, max: 24 });
const db = drizzle(pool);
const reader = new DrizzleAssignmentReader(db);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  userSupA: randomUUID(), userSup2: randomUUID(), userMemA: randomUUID(),
  userTechA: randomUUID(), userTech2: randomUUID(), userTechB: randomUUID(),
  memSupA: randomUUID(), memSup2: randomUUID(), memMemberA: randomUUID(),
  memTechA: randomUUID(), memTech2: randomUUID(), memTechB: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
};
const membershipLookup = new DrizzleMembershipLookup(db);
async function context(userId: string, org = ids.orgA) {
  return resolveTenantContext({ userId } as VerifiedSessionIdentity,
    org, membershipLookup);
}
async function makeOrder(org = ids.orgA) {
  const incident = await db.insert(incidents).values({
    organizationId: org,
    assetId: org === ids.orgA ? ids.assetA : ids.assetB,
    reportedByMembershipId: org === ids.orgA ? ids.memSupA : ids.memTechB,
    title: 'UC05 synthetic incident', description: 'Order requires a technician',
    status: 'UNDER_REVIEW',
  }).returning({ id: incidents.id });
  const incidentId = incident[0]!.id;
  const created = await createCorrectiveOrder(db,
    await context(org === ids.orgA ? ids.userSupA : ids.userTechB, org), {
      incidentId, idempotencyKey: randomUUID(), title: 'Inspect main pump',
      description: 'Inspect bearing and measure vibrations',
    });
  return { incidentId, orderId: created.id };
}
function input(incidentId: string, orderId: string,
  technicianMembershipId = ids.memTechA, expectedVersion = 0,
  idempotencyKey = randomUUID(), reason?: string) {
  return { incidentId, orderId, technicianMembershipId,
    expectedVersion, idempotencyKey, ...(reason ? { reason } : {}) };
}
const history = (orderId: string) => db.select().from(workOrderAssignments)
  .where(eq(workOrderAssignments.workOrderId, orderId))
  .orderBy(workOrderAssignments.version);
const state = async (id: string) => (await db.select({
  status: workOrders.status, assignee: workOrders.responsibleMembershipId,
  version: workOrders.assignmentVersion,
}).from(workOrders).where(eq(workOrders.id, id)))[0];

describe('UC-05 — transactional technician assignment in real PostgreSQL', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      ids.userSupA, ids.userSup2, ids.userMemA, ids.userTechA,
      ids.userTech2, ids.userTechB,
    ].map((id) => ({ id, displayName: 'UC05 User ' + id.slice(0, 4) })));
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'UC05 Plant A' },
      { id: ids.orgB, name: 'UC05 Plant B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.memSupA, organizationId: ids.orgA,
        userId: ids.userSupA, role: 'SUPERVISOR' },
      { id: ids.memSup2, organizationId: ids.orgA,
        userId: ids.userSup2, role: 'SUPERVISOR' },
      { id: ids.memMemberA, organizationId: ids.orgA,
        userId: ids.userMemA, role: 'MEMBER' },
      { id: ids.memTechA, organizationId: ids.orgA,
        userId: ids.userTechA, role: 'TECHNICIAN' },
      { id: ids.memTech2, organizationId: ids.orgA,
        userId: ids.userTech2, role: 'TECHNICIAN' },
      { id: ids.memTechB, organizationId: ids.orgB,
        userId: ids.userTechB, role: 'TECHNICIAN' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'UC05-A', name: 'Main pump' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'UC05-B', name: 'Foreign pump' },
    ]);
  });
  afterAll(async () => { await pool.end(); });

  it('assigns then reassigns atomically with a versioned immutable history', async () => {
    const { incidentId, orderId } = await makeOrder();
    const supervisor = await context(ids.userSupA);
    const initial = await assignTechnician(db, supervisor, input(incidentId, orderId));
    expect(initial).toMatchObject({ workOrderId: orderId, action: 'ASSIGNED',
      version: 1, fromMembershipId: null, toMembershipId: ids.memTechA,
      actorMembershipId: ids.memSupA, reason: null });
    expect(initial).not.toHaveProperty('requestHash');
    expect(initial).not.toHaveProperty('idempotencyKey');
    expect(await state(orderId)).toEqual({ status: 'ASSIGNED',
      assignee: ids.memTechA, version: 1 });
    const reassigned = await assignTechnician(db, supervisor,
      input(incidentId, orderId, ids.memTech2, 1, randomUUID(),
        'Cambio de turno y disponibilidad'));
    expect(reassigned).toMatchObject({ action: 'REASSIGNED', version: 2,
      fromMembershipId: ids.memTechA, toMembershipId: ids.memTech2,
      reason: 'Cambio de turno y disponibilidad' });
    expect(await state(orderId)).toEqual({ status: 'ASSIGNED',
      assignee: ids.memTech2, version: 2 });
    const visibleHistory = await reader.history(supervisor, incidentId, orderId);
    expect(visibleHistory.map(({ fromName: _from, toName: _to,
      actorName: _actor, ...item }) => {
      void _from; void _to; void _actor; return item;
    })).toEqual([initial, reassigned]);
    expect(visibleHistory[0]).toMatchObject({
      fromName: null, toName: expect.any(String), actorName: expect.any(String),
    });
    expect(await reader.technicians(supervisor)).toHaveLength(2);
    await expect(db.update(workOrderAssignments).set({ reason: 'tampered' })
      .where(eq(workOrderAssignments.id, initial.id))).rejects.toThrow();
    await expect(db.delete(workOrderAssignments)
      .where(eq(workOrderAssignments.id, initial.id))).rejects.toThrow();
    expect(await history(orderId)).toHaveLength(2);
  });

  it('replays historical first assignment even after later reassignment', async () => {
    const { incidentId, orderId } = await makeOrder();
    const supervisor = await context(ids.userSupA);
    const original = input(incidentId, orderId);
    const assigned = await assignTechnician(db, supervisor, original);
    await assignTechnician(db, supervisor,
      input(incidentId, orderId, ids.memTech2, 1));
    expect(await assignTechnician(db, supervisor, {
      ...original, idempotencyKey: original.idempotencyKey.toUpperCase(),
    })).toEqual(assigned);
    await expect(assignTechnician(db, supervisor, {
      ...original, technicianMembershipId: ids.memTech2,
    })).rejects.toThrow(ConflictException);
    await expect(assignTechnician(db, supervisor,
      input(incidentId, orderId, ids.memTechA, 1)))
      .rejects.toThrow(ConflictException);
    expect(await history(orderId)).toHaveLength(2);
  });

  it('rejects wrong role, foreign technician, stale supervisor and inactive target', async () => {
    const { incidentId, orderId } = await makeOrder();
    const data = input(incidentId, orderId);
    for (const userId of [ids.userMemA, ids.userTechA]) {
      await expect(assignTechnician(db, await context(userId), data))
        .rejects.toThrow(ForbiddenException);
    }
    const supervisor = await context(ids.userSupA);
    await expect(assignTechnician(db, supervisor, {
      ...data, technicianMembershipId: ids.memTechB,
    })).rejects.toThrow(ConflictException);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.memTechA));
    try {
      await expect(assignTechnician(db, supervisor, data))
        .rejects.toThrow(ConflictException);
      expect(await reader.technicians(supervisor)).toHaveLength(1);
    } finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.memTechA));
    }
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.memSupA));
    try {
      await expect(assignTechnician(db, supervisor, data))
        .rejects.toThrow(ForbiddenException);
    } finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.memSupA));
    }
    expect(await state(orderId)).toMatchObject({ status: 'PENDING', version: 0 });
    expect(await history(orderId)).toHaveLength(0);
  });

  it('rejects invalid payload, unrelated incident and work already started', async () => {
    const { incidentId, orderId } = await makeOrder();
    const other = await makeOrder();
    const supervisor = await context(ids.userSupA);
    for (const invalid of [
      { idempotencyKey: 'invalid' }, { technicianMembershipId: 'invalid' },
      { expectedVersion: -1 }, { expectedVersion: 1.5 },
      { reason: 'x' }, { reason: 'X'.repeat(501) },
    ]) {
      await expect(assignTechnician(db, supervisor, {
        ...input(incidentId, orderId), ...invalid,
      })).rejects.toThrow(BadRequestException);
    }
    await expect(assignTechnician(db, supervisor, input(incidentId, other.orderId)))
      .rejects.toThrow(NotFoundException);
    await assignTechnician(db, supervisor, input(incidentId, orderId));
    await expect(assignTechnician(db, supervisor,
      input(incidentId, orderId, ids.memTechA, 1)))
      .rejects.toThrow(ConflictException);
    await db.update(workOrders).set({ status: 'IN_PROGRESS' })
      .where(eq(workOrders.id, orderId));
    await expect(assignTechnician(db, supervisor,
      input(incidentId, orderId, ids.memTech2, 1)))
      .rejects.toThrow(ConflictException);
    expect(await history(orderId)).toHaveLength(1);
  });

  it('serializes concurrent competing supervisors: exactly one wins version 0', async () => {
    const { incidentId, orderId } = await makeOrder();
    const supervisorA = await context(ids.userSupA);
    const supervisorB = await context(ids.userSup2);
    const attempts = await Promise.allSettled(Array.from({ length: 14 }, (_, n) =>
      assignTechnician(db, n % 2 ? supervisorA : supervisorB,
        input(incidentId, orderId, n % 2 ? ids.memTech2 : ids.memTechA))));
    expect(attempts.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((item) => item.status === 'rejected')).toHaveLength(13);
    expect((await state(orderId))?.version).toBe(1);
    expect(await history(orderId)).toHaveLength(1);
  });

  it('simultaneous same-key retries create one event and return the same version', async () => {
    const { incidentId, orderId } = await makeOrder();
    const supervisor = await context(ids.userSupA);
    const same = input(incidentId, orderId);
    const results = await Promise.all(Array.from({ length: 12 }, () =>
      assignTechnician(db, supervisor, same)));
    expect(new Set(results.map((item) => item.id)).size).toBe(1);
    expect((await state(orderId))?.version).toBe(1);
    expect(await history(orderId)).toHaveLength(1);
  });

  it('rolls back order state when audit insert fails', async () => {
    const { incidentId, orderId } = await makeOrder();
    await db.execute(sql`CREATE FUNCTION uc05_reject_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced audit failure'; END; $$`);
    await db.execute(sql`CREATE TRIGGER uc05_reject_insert_trigger
      BEFORE INSERT ON work_order_assignments
      FOR EACH ROW EXECUTE FUNCTION uc05_reject_insert()`);
    try {
      await expect(assignTechnician(db, await context(ids.userSupA),
        input(incidentId, orderId))).rejects.toThrow();
      expect(await state(orderId)).toEqual({
        status: 'PENDING', assignee: null, version: 0,
      });
      expect(await history(orderId)).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER uc05_reject_insert_trigger
        ON work_order_assignments`);
      await db.execute(sql`DROP FUNCTION uc05_reject_insert()`);
    }
  });
});
