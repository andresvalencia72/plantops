import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrderEvents } from '../src/database/work-order-events.js';
import { workOrders } from '../src/database/work-orders.js';
import { createCorrectiveOrder } from '../src/work-orders/create-corrective-order.js';
import { DrizzleMembershipLookup } from '../src/security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../src/security/tenant-context.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const target = new URL(url);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) throw new Error('Only loopback *_test allowed');
const pool = new Pool({ connectionString: url, max: 24 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  supA: randomUUID(), sup2A: randomUUID(), memberA: randomUUID(),
  techA: randomUUID(), supB: randomUUID(),
  msA: randomUUID(), ms2A: randomUUID(), mmA: randomUUID(),
  mtA: randomUUID(), msB: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
};
const input = (incidentId: string, key: string = randomUUID()) => ({
  incidentId, idempotencyKey: key,
  title: 'Revisar bomba principal',
  description: 'Verificar la vibración y la temperatura del motor',
});
const list = (incidentId: string) => db.select().from(workOrders).where(
  and(eq(workOrders.organizationId, ids.orgA), eq(workOrders.incidentId, incidentId)));
const events = (workOrderId: string) => db.select().from(workOrderEvents)
  .where(eq(workOrderEvents.workOrderId, workOrderId));
const state = async (id: string) => (await db.select({ status: incidents.status })
  .from(incidents).where(eq(incidents.id, id)))[0]?.status;

async function context(userId: string, org = ids.orgA) {
  return resolveTenantContext({ userId } as VerifiedSessionIdentity,
    org, new DrizzleMembershipLookup(db));
}
async function fixture(status: 'UNDER_REVIEW' | 'REPORTED' | 'IN_PROGRESS' |
  'CLOSED' = 'UNDER_REVIEW', org = ids.orgA) {
  const [row] = await db.insert(incidents).values({
    organizationId: org, assetId: org === ids.orgA ? ids.assetA : ids.assetB,
    reportedByMembershipId: org === ids.orgA ? ids.msA : ids.msB,
    title: 'Corrective fixture', description: 'Synthetic work order acceptance',
    status,
  }).returning({ id: incidents.id });
  if (!row) throw new Error('Could not seed isolated incident');
  return row.id;
}

describe('UC-04 corrective order: persistent invariants', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      ids.supA, ids.sup2A, ids.memberA, ids.techA, ids.supB,
    ].map((id) => ({ id, displayName: 'Synthetic UC04 ' + id.slice(0, 5) })));
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'UC04 A' }, { id: ids.orgB, name: 'UC04 B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.msA, organizationId: ids.orgA, userId: ids.supA, role: 'SUPERVISOR' },
      { id: ids.ms2A, organizationId: ids.orgA, userId: ids.sup2A, role: 'SUPERVISOR' },
      { id: ids.mmA, organizationId: ids.orgA, userId: ids.memberA, role: 'MEMBER' },
      { id: ids.mtA, organizationId: ids.orgA, userId: ids.techA, role: 'TECHNICIAN' },
      { id: ids.msB, organizationId: ids.orgB, userId: ids.supB, role: 'SUPERVISOR' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'UC04-A', name: 'Pump A' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'UC04-B', name: 'Pump B' },
    ]);
  });
  afterAll(async () => { await pool.end(); });

  it('creates pending corrective orders with one auditable incident transition', async () => {
    const incidentId = await fixture();
    const actor = await context(ids.supA);
    const first = await createCorrectiveOrder(db, actor, input(incidentId));
    expect(first).toMatchObject({ incidentId, assetId: ids.assetA,
      status: 'PENDING', title: 'Revisar bomba principal' });
    expect(first).not.toHaveProperty('organizationId');
    expect(first).not.toHaveProperty('requestHash');
    expect(first).not.toHaveProperty('createdByMembershipId');
    expect(await state(incidentId)).toBe('IN_PROGRESS');
    const [firstEvent] = await events(first.id);
    expect(firstEvent).toMatchObject({ organizationId: ids.orgA,
      actorMembershipId: ids.msA, action: 'WORK_ORDER_CREATED',
      fromIncidentStatus: 'UNDER_REVIEW', toIncidentStatus: 'IN_PROGRESS' });
    const second = await createCorrectiveOrder(db, actor, {
      ...input(incidentId), title: 'Medir presión de aceite',
    });
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('PENDING');
    expect((await events(second.id))[0]).toMatchObject({
      fromIncidentStatus: null, toIncidentStatus: null,
    });
    expect(await list(incidentId)).toHaveLength(2);
    expect(await state(incidentId)).toBe('IN_PROGRESS');
  });

  it('same key replays one order; changing request or incident returns conflict', async () => {
    const incidentId = await fixture();
    const actor = await context(ids.supA);
    const key = randomUUID();
    const first = await createCorrectiveOrder(db, actor, input(incidentId, key));
    const again = await createCorrectiveOrder(db, actor, input(incidentId, key.toUpperCase()));
    expect(again.id).toBe(first.id);
    await expect(createCorrectiveOrder(db, actor, {
      ...input(incidentId, key), title: 'Different title',
    })).rejects.toThrow(ConflictException);
    await expect(createCorrectiveOrder(db, actor,
      input(await fixture(), key))).rejects.toThrow(ConflictException);
    expect(await list(incidentId)).toHaveLength(1);
    expect(await events(first.id)).toHaveLength(1);
  });

  it('never creates from REPORTED or CLOSED, and denies another organization', async () => {
    const actor = await context(ids.supA);
    for (const status of ['REPORTED', 'CLOSED'] as const) {
      const id = await fixture(status);
      await expect(createCorrectiveOrder(db, actor, input(id)))
        .rejects.toThrow(ConflictException);
      expect(await state(id)).toBe(status);
    }
    const foreign = await fixture('UNDER_REVIEW', ids.orgB);
    await expect(createCorrectiveOrder(db, actor, input(foreign)))
      .rejects.toThrow(NotFoundException);
    expect(await state(foreign)).toBe('UNDER_REVIEW');
  });

  it('rejects member, technician and stale supervisor permissions', async () => {
    const id = await fixture();
    for (const uid of [ids.memberA, ids.techA]) {
      await expect(createCorrectiveOrder(db, await context(uid), input(id)))
        .rejects.toThrow(ForbiddenException);
    }
    const stale = await context(ids.supA);
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.msA));
    try {
      await expect(createCorrectiveOrder(db, stale, input(id)))
        .rejects.toThrow(ForbiddenException);
    } finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.msA));
    }
    expect(await list(id)).toHaveLength(0);
  });

  it('rejects invalid input and inactive assets without side effects', async () => {
    const id = await fixture();
    const actor = await context(ids.supA);
    for (const change of [
      { idempotencyKey: 'invalid' }, { title: 'a' }, { description: '' },
    ]) {
      await expect(createCorrectiveOrder(db, actor, { ...input(id), ...change }))
        .rejects.toThrow(BadRequestException);
    }
    await db.update(assets).set({ active: false }).where(eq(assets.id, ids.assetA));
    try {
      await expect(createCorrectiveOrder(db, actor, input(id)))
        .rejects.toThrow(ConflictException);
    } finally {
      await db.update(assets).set({ active: true }).where(eq(assets.id, ids.assetA));
    }
    expect(await state(id)).toBe('UNDER_REVIEW');
    expect(await list(id)).toHaveLength(0);
  });

  it('concurrent distinct requests all create orders but advance incident only once', async () => {
    const id = await fixture();
    const a = await context(ids.supA);
    const b = await context(ids.sup2A);
    const results = await Promise.all(Array.from({ length: 16 }, (_, n) =>
      createCorrectiveOrder(db, n % 2 ? a : b, {
        ...input(id), title: 'Intervention ' + n,
      })));
    expect(new Set(results.map((item) => item.id)).size).toBe(16);
    expect(await state(id)).toBe('IN_PROGRESS');
    const all = (await Promise.all(results.map((item) => events(item.id)))).flat();
    expect(all).toHaveLength(16);
    expect(all.filter((e) => e.fromIncidentStatus === 'UNDER_REVIEW')).toHaveLength(1);
  });

  it('simultaneous same-key retries produce just one order and one event', async () => {
    const id = await fixture();
    const actor = await context(ids.supA);
    const data = input(id);
    const results = await Promise.all(Array.from({ length: 15 }, () =>
      createCorrectiveOrder(db, actor, data)));
    expect(new Set(results.map((item) => item.id)).size).toBe(1);
    expect(await list(id)).toHaveLength(1);
    expect(await events(results[0]!.id)).toHaveLength(1);
  });

  it('database rejects foreign tenant/asset references and immutable audit edits', async () => {
    const id = await fixture();
    const row = { organizationId: ids.orgA, incidentId: id,
      assetId: ids.assetB, createdByMembershipId: ids.msA,
      idempotencyKey: randomUUID(), requestHash: 'synthetic',
      title: 'Invalid order', description: 'Should never persist',
    };
    await expect(db.insert(workOrders).values(row)).rejects.toThrow();
    await expect(db.insert(workOrders).values({
      ...row, assetId: ids.assetA, createdByMembershipId: ids.msB,
    })).rejects.toThrow();
    const order = await createCorrectiveOrder(db, await context(ids.supA), input(id));
    const [event] = await events(order.id);
    await expect(db.update(workOrderEvents).set({ toIncidentStatus: null })
      .where(eq(workOrderEvents.id, event!.id))).rejects.toThrow();
    await expect(db.delete(workOrderEvents).where(eq(workOrderEvents.id, event!.id)))
      .rejects.toThrow();
    await expect(db.insert(workOrderEvents).values({
      organizationId: ids.orgA, workOrderId: order.id,
      actorMembershipId: ids.msB, action: 'WORK_ORDER_CREATED',
    })).rejects.toThrow();
  });

  it('failed audit insertion rolls back both order and incident transition', async () => {
    const id = await fixture();
    const actor = await context(ids.supA);
    await pool.query(`CREATE FUNCTION uc04_reject_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END; $$`);
    await pool.query(`CREATE TRIGGER uc04_reject_audit BEFORE INSERT ON work_order_events
      FOR EACH ROW EXECUTE FUNCTION uc04_reject_insert()`);
    try {
      await expect(createCorrectiveOrder(db, actor, input(id)))
        .rejects.toThrow();
    } finally {
      await pool.query('DROP TRIGGER uc04_reject_audit ON work_order_events');
      await pool.query('DROP FUNCTION uc04_reject_insert()');
    }
    expect(await list(id)).toHaveLength(0);
    expect(await state(id)).toBe('UNDER_REVIEW');
  });
});
