import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assets } from '../src/database/assets.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { workOrders } from '../src/database/work-orders.js';

const connection = process.env.DATABASE_TEST_URL;
if (!connection) throw new Error('DATABASE_TEST_URL required');
const url = new URL(connection);
if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
  !url.pathname.endsWith('_test')) throw new Error('Disposable test DB only');
const pool = new Pool({ connectionString: connection });
const db = drizzle(pool);
const ids = {
  organization: randomUUID(), user: randomUUID(), member: randomUUID(),
  asset: randomUUID(), order: randomUUID(),
};
const role = `plantops_status_probe_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

function code(expected: string) {
  return (error: unknown) => {
    const item = error as { code?: string; cause?: { code?: string } };
    return item?.code === expected || item?.cause?.code === expected;
  };
}

describe('Sprint 3X — terminal status guard with a non-admin SQL role', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder:
      fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.insert(organizations).values({
      id: ids.organization, name: 'Terminal status audit tenant',
    });
    await db.insert(users).values({
      id: ids.user, displayName: 'Status audit operator',
    });
    await db.insert(memberships).values({
      id: ids.member, userId: ids.user,
      organizationId: ids.organization, role: 'SUPERVISOR',
    });
    await db.insert(assets).values({
      id: ids.asset, organizationId: ids.organization,
      name: 'Terminal status test pump', code: 'TERMINAL-GUARD',
    });
    await db.insert(workOrders).values({
      id: ids.order, organizationId: ids.organization, assetId: ids.asset,
      createdByMembershipId: ids.member, kind: 'PREVENTIVE',
      title: 'Historical completed inspection',
      description: 'Evidence must remain final even when SQL has UPDATE permission',
      status: 'COMPLETED', idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
    });
    // Only this disposable PostgreSQL container receives the throwaway role.
    // Its rights are deliberately narrower than application runtime rights.
    await pool.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await pool.query(`GRANT SELECT, UPDATE(status) ON public.work_orders
      TO "${role}"`);
  });
  afterAll(async () => {
    await pool.query(`DROP OWNED BY "${role}"`);
    await pool.query(`DROP ROLE "${role}"`);
    await pool.end();
  });

  it('limits the throwaway role to reading and updating order status', async () => {
    const { rows: [flags] } = await pool.query<{
      rolsuper: boolean; rolcreatedb: boolean;
      rolcreaterole: boolean; rolbypassrls: boolean;
    }>(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
       FROM pg_roles WHERE rolname=$1`, [role]);
    expect(flags).toEqual({
      rolsuper: false, rolcreatedb: false,
      rolcreaterole: false, rolbypassrls: false,
    });
    const { rows: [access] } = await pool.query<{
      can_update: boolean; can_trigger: boolean;
    }>(`SELECT has_column_privilege($1, 'public.work_orders', 'status',
         'UPDATE') AS can_update,
         has_table_privilege($1, 'public.work_orders',
         'TRIGGER') AS can_trigger`, [role]);
    expect(access).toEqual({ can_update: true, can_trigger: false });
  });

  it('rejects reopen even when SQL role has UPDATE(status)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE "${role}"`);
      await expect(client.query(
        'UPDATE public.work_orders SET status=$1 WHERE id=$2',
        ['IN_PROGRESS', ids.order],
      )).rejects.toSatisfy(code('55000'));
      await client.query('ROLLBACK');
      const [row] = await db.select({ status: workOrders.status })
        .from(workOrders).where(eq(workOrders.id, ids.order));
      expect(row?.status).toBe('COMPLETED');
    } finally {
      client.release();
    }
  });

  it('does not let a non-owning SQL role disable the protection', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE "${role}"`);
      await expect(client.query(`ALTER TABLE public.work_orders
        DISABLE TRIGGER work_orders_terminal_status_is_final`))
        .rejects.toSatisfy(code('42501'));
      await client.query('ROLLBACK');
      const { rows: [trigger] } = await pool.query<{ tgenabled: string }>(
        `SELECT tgenabled FROM pg_trigger
         WHERE tgname='work_orders_terminal_status_is_final'
           AND tgrelid='public.work_orders'::regclass`,
      );
      expect(trigger?.tgenabled).toBe('O');
    } finally {
      client.release();
    }
  });

  it('allows a harmless no-op status write under limited privileges', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE "${role}"`);
      const updated = await client.query(`UPDATE public.work_orders
        SET status='COMPLETED' WHERE id=$1`, [ids.order]);
      expect(updated.rowCount).toBe(1);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});
