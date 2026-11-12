import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrders } from '../src/database/work-orders.js';
import { DrizzleWorkOrderReader } from '../src/work-orders/drizzle-work-order-reader.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../src/security/tenant-context.js';
import { DrizzleMembershipLookup } from '../src/security/drizzle-membership-lookup.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) throw new Error('Only disposable loopback DB allowed');
const pool = new Pool({ connectionString: url, max: 8 });
const db = drizzle(pool);
const reader = new DrizzleWorkOrderReader(db);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(), userA: randomUUID(), userB: randomUUID(),
  memberA: randomUUID(), memberB: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
  incidentA: randomUUID(), incidentB: randomUUID(),
  orderA: randomUUID(), orderB: randomUUID(), orderC: randomUUID(), foreignOrder: randomUUID(),
};
let contextA: Awaited<ReturnType<typeof resolveTenantContext>>;
let contextB: Awaited<ReturnType<typeof resolveTenantContext>>;

const insertOrder = (id: string, organizationId: string, incidentId: string,
  assetId: string, createdByMembershipId: string, title: string) => ({
  id, organizationId, incidentId, assetId, createdByMembershipId,
  idempotencyKey: randomUUID(), requestHash: 'synthetic',
  title, description: 'Synthetic readable order details',
});

describe('UC-04 protected work-order reads', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(users).values([
      { id: ids.userA, displayName: 'Order reader A' },
      { id: ids.userB, displayName: 'Order reader B' },
    ]);
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Order tenant A' }, { id: ids.orgB, name: 'Order tenant B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.memberA, userId: ids.userA, organizationId: ids.orgA, role: 'MEMBER' },
      { id: ids.memberB, userId: ids.userB, organizationId: ids.orgB, role: 'TECHNICIAN' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, code: 'ORD-A', name: 'Pump A' },
      { id: ids.assetB, organizationId: ids.orgB, code: 'ORD-B', name: 'Pump B' },
    ]);
    await db.insert(incidents).values([
      { id: ids.incidentA, organizationId: ids.orgA, assetId: ids.assetA,
        reportedByMembershipId: ids.memberA, title: 'Read A', description: 'Read test A' },
      { id: ids.incidentB, organizationId: ids.orgB, assetId: ids.assetB,
        reportedByMembershipId: ids.memberB, title: 'Read B', description: 'Read test B' },
    ]);
    await db.insert(workOrders).values([
      insertOrder(ids.orderA, ids.orgA, ids.incidentA, ids.assetA, ids.memberA, 'First A'),
      insertOrder(ids.orderB, ids.orgA, ids.incidentA, ids.assetA, ids.memberA, 'Second A'),
      insertOrder(ids.orderC, ids.orgA, ids.incidentA, ids.assetA, ids.memberA, 'Third A'),
      insertOrder(ids.foreignOrder, ids.orgB, ids.incidentB, ids.assetB, ids.memberB, 'Private B'),
    ]);
    // Sub-millisecond timestamps reproduce the precision loss of JS Date.
    for (const [id, value] of [
      [ids.orderA, '2026-11-12T12:00:00.123456Z'],
      [ids.orderB, '2026-11-12T12:00:00.123123Z'],
      [ids.orderC, '2026-11-12T12:00:00.122999Z'],
    ]) {
      await db.execute(sql`UPDATE work_orders SET created_at = ${value}::timestamptz
        WHERE id = ${id}::uuid`);
    }
    const membershipLookup = new DrizzleMembershipLookup(db);
    contextA = await resolveTenantContext({ userId: ids.userA } as VerifiedSessionIdentity,
      ids.orgA, membershipLookup);
    contextB = await resolveTenantContext({ userId: ids.userB } as VerifiedSessionIdentity,
      ids.orgB, membershipLookup);
  });
  afterAll(async () => { await pool.end(); });

  it('uses exact timestamp keysets so sub-millisecond records cannot disappear', async () => {
    const first = await reader.list(contextA, ids.incidentA, '1');
    expect(first.items.map((item) => item.id)).toEqual([ids.orderA]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const decoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString());
    expect(decoded.createdAt).toBe('2026-11-12T12:00:00.123456Z');
    const second = await reader.list(contextA, ids.incidentA, '1', first.nextCursor!);
    expect(second.items.map((item) => item.id)).toEqual([ids.orderB]);
    const third = await reader.list(contextA, ids.incidentA, '1', second.nextCursor!);
    expect(third.items.map((item) => item.id)).toEqual([ids.orderC]);
    expect(third.nextCursor).toBeNull();
    for (const page of [first, second, third]) {
      expect(page.items[0]).toEqual({
        id: expect.any(String), incidentId: ids.incidentA,
        assetId: ids.assetA, title: expect.any(String),
        status: 'PENDING', responsibleMembershipId: null,
        assignmentVersion: 0, createdAt: expect.any(Date),
      });
      expect(page.items[0]).not.toHaveProperty('createdByMembershipId');
      expect(page.items[0]).not.toHaveProperty('requestHash');
      expect(page.items[0]).not.toHaveProperty('idempotencyKey');
      expect(page.items[0]).not.toHaveProperty('cursorTime');
    }
  });

  it('returns full detail only for a visible order of the selected incident', async () => {
    expect(await reader.findById(contextA, ids.incidentA, ids.orderA)).toEqual({
      id: ids.orderA, incidentId: ids.incidentA, assetId: ids.assetA,
      title: 'First A', description: 'Synthetic readable order details',
      status: 'PENDING', responsibleMembershipId: null,
        assignmentVersion: 0, createdAt: expect.any(Date),
    });
    await expect(reader.findById(contextA, ids.incidentA, ids.foreignOrder))
      .rejects.toThrow(NotFoundException);
    await expect(reader.findById(contextA, ids.incidentB, ids.orderA))
      .rejects.toThrow(NotFoundException);
  });

  it('does not reveal any foreign tenant or non-existent parent', async () => {
    await expect(reader.list(contextA, ids.incidentB)).rejects.toThrow(NotFoundException);
    await expect(reader.list(contextB, ids.incidentA)).rejects.toThrow(NotFoundException);
    await expect(reader.list(contextA, randomUUID())).rejects.toThrow(NotFoundException);
    expect((await reader.list(contextB, ids.incidentB)).items)
      .toMatchObject([{ id: ids.foreignOrder, title: 'Private B' }]);
  });

  it('rejects malformed limits and cursors without returning data', async () => {
    for (const limit of ['0', '-1', '51', 'NaN', '1.5', '1e2', ' 2', '02', '']) {
      await expect(reader.list(contextA, ids.incidentA, limit))
        .rejects.toThrow(BadRequestException);
    }
    for (const cursor of ['$', 'bad', 'a'.repeat(300),
      Buffer.from(JSON.stringify({ createdAt: 'yesterday', id: ids.orderA }))
        .toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: '2026-11-12T12:00:00.123Z',
        id: ids.orderA })).toString('base64url')]) {
      await expect(reader.list(contextA, ids.incidentA, '2', cursor))
        .rejects.toThrow(BadRequestException);
    }
  });
});
