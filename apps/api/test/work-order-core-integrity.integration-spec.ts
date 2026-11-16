import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrders } from '../src/database/work-orders.js';

const connection = process.env.DATABASE_TEST_URL;
if (!connection) throw new Error('DATABASE_TEST_URL required');
const url = new URL(connection);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) ||
  !url.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const pool = new Pool({ connectionString: connection, max: 4 });
const db = drizzle(pool);
const ids = {
  org: randomUUID(), user: randomUUID(), actor: randomUUID(),
  asset: randomUUID(), completed: randomUUID(), open: randomUUID(),
};
const isSqlCode = (code: string) => (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === code || e?.cause?.code === code;
};

describe('Sprint 3Y — immutable work order core metadata', () => {
  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(organizations).values({ id: ids.org, name: 'Core metadata tenant' });
    await db.insert(users).values({ id: ids.user, displayName: 'Core auditor' });
    await db.insert(memberships).values({
      id: ids.actor, userId: ids.user,
      organizationId: ids.org, role: 'SUPERVISOR',
    });
    await db.insert(assets).values({
      id: ids.asset, organizationId: ids.org, name: 'Core pump', code: 'CORE-PUMP',
    });
    await db.insert(workOrders).values([
      {
        id: ids.completed, organizationId: ids.org, assetId: ids.asset,
        createdByMembershipId: ids.actor, kind: 'PREVENTIVE',
        title: 'Completed original inspection',
        description: 'Evidence signed before the work was closed',
        status: 'COMPLETED', idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
      },
      {
        id: ids.open, organizationId: ids.org, assetId: ids.asset,
        createdByMembershipId: ids.actor, kind: 'PREVENTIVE',
        title: 'Pending original inspection',
        description: 'Evidence must stay consistent while assigning a technician',
        idempotencyKey: randomUUID(), requestHash: randomUUID(),
      },
    ]);
  });
  afterAll(async () => { await pool.end(); });

  it('rejects title, description and creation timestamps on terminal and open orders', async () => {
    for (const id of [ids.completed, ids.open]) {
      for (const mutation of [
        { title: 'Forged inspection label' },
        { description: 'Forged inspection details' },
        { createdAt: new Date('2020-01-01T00:00:00Z') },
      ]) {
        await expect(db.update(workOrders).set(mutation)
          .where(eq(workOrders.id, id))).rejects.toSatisfy(isSqlCode('55000'));
      }
    }
  });

  it('prevents impersonating creator, retry evidence or order type', async () => {
    const mutation = [
      { createdByMembershipId: ids.actor }, // no-op remains acceptable
      { idempotencyKey: randomUUID() },
      { requestHash: 'different' },
      { kind: 'CORRECTIVE' as const },
    ];
    await db.update(workOrders).set(mutation[0])
      .where(eq(workOrders.id, ids.open));
    for (const change of mutation.slice(1)) {
      await expect(db.update(workOrders).set(change)
        .where(eq(workOrders.id, ids.open))).rejects.toSatisfy(isSqlCode('55000'));
    }
  });

  it('locks assignment metadata on terminal orders, allows normal open assignments', async () => {
    await expect(db.update(workOrders).set({
      responsibleMembershipId: ids.actor, assignmentVersion: 1,
    }).where(eq(workOrders.id, ids.completed)))
      .rejects.toSatisfy(isSqlCode('55000'));
    await db.update(workOrders).set({
      status: 'ASSIGNED', responsibleMembershipId: ids.actor,
      assignmentVersion: 1,
    }).where(eq(workOrders.id, ids.open));
    const [open] = await db.select({
      status: workOrders.status, assignmentVersion: workOrders.assignmentVersion,
    }).from(workOrders).where(eq(workOrders.id, ids.open));
    expect(open).toEqual({ status: 'ASSIGNED', assignmentVersion: 1 });
    await db.update(workOrders).set({ title: 'Completed original inspection' })
      .where(eq(workOrders.id, ids.completed));
  });
});
