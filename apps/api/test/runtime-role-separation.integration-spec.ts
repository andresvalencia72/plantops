import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPreventiveOrder } from '../src/work-orders/create-preventive-order.js';
import { assets } from '../src/database/assets.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { plants } from '../src/database/plants.js';
import { runtimeGrantStatements, runtimePermissions, runtimeLockColumns } from
  '../scripts/runtime-role-policy.mjs';
import type { TenantContext } from '../src/security/tenant-context.js';

const connection = process.env.DATABASE_TEST_URL;
if (!connection) throw new Error('DATABASE_TEST_URL required');
const target = new URL(connection);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) ||
    !target.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');

const migratorPool = new Pool({ connectionString: connection, max: 5 });
const migrator = drizzle(migratorPool);
const role = `plantops_runtime_lab_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const password = randomBytes(30).toString('hex'); // test-only, never log or persist
const runtimeUrl = new URL(connection);
runtimeUrl.username = role;
runtimeUrl.password = password;
const runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 4 });
const runtime = drizzle(runtimePool);
const ids = {
  org: randomUUID(), user: randomUUID(), membership: randomUUID(),
  asset: randomUUID(), plant: randomUUID(),
};
const context: TenantContext = {
  organizationId: ids.org, userId: ids.user,
  membershipId: ids.membership, role: 'SUPERVISOR',
};
const code = (expected: string) => (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === expected || e?.cause?.code === expected;
};

describe('Sprint 3Y — separate migrator and runtime identities', () => {
  beforeAll(async () => {
    await migrate(migrator, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await migrator.insert(organizations).values({
      id: ids.org, name: 'Runtime role isolated tenant',
    });
    await migrator.insert(users).values({
      id: ids.user, displayName: 'Runtime role supervisor',
    });
    await migrator.insert(memberships).values({
      id: ids.membership, organizationId: ids.org, userId: ids.user,
      role: 'SUPERVISOR',
    });
    await migrator.insert(assets).values({
      id: ids.asset, organizationId: ids.org,
      code: 'RUNTIME-PUMP', name: 'Runtime role equipment',
    });
    await migrator.insert(plants).values({
      id: ids.plant, organizationId: ids.org,
      name: 'Runtime isolation plant', timeZone: 'Europe/Madrid',
    });
    // Created by a privileged *test migrator*, not the application.
    // Password is generated in-memory and is never written to disk.
    await migratorPool.query(`CREATE ROLE "${role}" LOGIN
      PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS`);
    for (const statement of runtimeGrantStatements(role)) {
      await migratorPool.query(statement);
    }
  });
  afterAll(async () => {
    await runtimePool.end();
    await migratorPool.query(`DROP OWNED BY "${role}"`);
    await migratorPool.query(`DROP ROLE "${role}"`);
    await migratorPool.end();
  });

  it('passes the same read-only privilege preflight used in deployment review', () => {
    const stdout = execFileSync(process.execPath,
      ['scripts/audit-postgres-role.mjs'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, DATABASE_URL: runtimeUrl.toString() },
        encoding: 'utf8',
        timeout: 6_000,
      });
    const report = JSON.parse(stdout) as Record<string, unknown>;
    expect(report).toMatchObject({
      role, suitability: 'PRIVILEGE_PREFLIGHT_PASS',
      schemaMatchesManifest: true, tableDmlMatchesManifest: true,
      lockColumnGrantsPresent: true,
    });
  });

  it('logs in separately and can run a real audited API use case', async () => {
    const { rows: [identity] } = await runtimePool.query<{
      current_user: string; session_user: string;
    }>('SELECT current_user, session_user');
    expect(identity).toEqual({ current_user: role, session_user: role });
    const result = await createPreventiveOrder(runtime, context, {
      assetId: ids.asset,
      title: 'Runtime inspection of cooling system',
      description: 'Inspection should be created through the restricted runtime identity',
      idempotencyKey: randomUUID(),
    });
    expect(result).toMatchObject({ kind: 'PREVENTIVE', status: 'PENDING' });
  });

  it('grants precisely the reviewed DML table set without DELETE on business records', async () => {
    const actual = await migratorPool.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables
      WHERE schemaname='public' ORDER BY tablename`);
    expect(actual.rows.map((x) => x.tablename).sort())
      .toEqual(Object.keys(runtimePermissions).sort());

    for (const [table, permitted] of Object.entries(runtimePermissions)) {
      for (const operation of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const { rows: [item] } = await migratorPool.query<{ allowed: boolean }>(
          'SELECT has_table_privilege($1, $2, $3) AS allowed',
          [role, `public.${table}`, operation],
        );
        expect(item.allowed, `${table} ${operation}`)
          .toBe(permitted.split(', ').includes(operation));
      }
    }
    for (const [table, column] of Object.entries(runtimeLockColumns)) {
      const { rows: [item] } = await migratorPool.query<{ allowed: boolean }>(
        'SELECT has_column_privilege($1, $2, $3, $4) AS allowed',
        [role, `public.${table}`, column, 'UPDATE'],
      );
      expect(item.allowed, `${table} UPDATE(${column})`).toBe(true);
    }
    for (const [table, column] of [
      ['memberships', 'status'],
      ['memberships', 'role'],
      ['plants', 'time_zone'],
    ]) {
      const { rows: [item] } = await migratorPool.query<{ allowed: boolean }>(
        'SELECT has_column_privilege($1, $2, $3, $4) AS allowed',
        [role, `public.${table}`, column, 'UPDATE'],
      );
      expect(item.allowed, `${table} UPDATE(${column})`).toBe(false);
    }
  });

  it('cannot create DDL, disable triggers, or mutate audit events', async () => {
    const { rows: [caps] } = await runtimePool.query<{
      superuser: boolean; createdb: boolean; createrole: boolean;
      bypassrls: boolean; schema_create: boolean;
    }>(`SELECT rolsuper AS superuser, rolcreatedb AS createdb,
      rolcreaterole AS createrole, rolbypassrls AS bypassrls,
      has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create
      FROM pg_roles WHERE rolname=current_user`);
    expect(caps).toEqual({
      superuser: false, createdb: false, createrole: false,
      bypassrls: false, schema_create: false,
    });
    await expect(runtimePool.query(`ALTER TABLE public.work_orders
      DISABLE TRIGGER work_orders_terminal_status_is_final`))
      .rejects.toSatisfy(code('42501'));
    await expect(runtimePool.query(
      'DELETE FROM public.work_order_events',
    )).rejects.toSatisfy(code('42501'));
    await expect(runtimePool.query(
      'UPDATE public.work_order_events SET id = id',
    )).rejects.toSatisfy(code('42501'));
    await expect(runtimePool.query(
      'CREATE TABLE public.runtime_should_not_create (id int)',
    )).rejects.toSatisfy(code('42501'));
    await expect(runtimePool.query(
      'UPDATE public.memberships SET status=$1 WHERE id=$2',
      ['SUSPENDED', ids.membership],
    )).rejects.toSatisfy(code('42501'));
    await expect(runtimePool.query(
      'UPDATE public.memberships SET id=$1 WHERE id=$2',
      [randomUUID(), ids.membership],
    )).rejects.toSatisfy(code('55000'));
    await expect(runtimePool.query(
      'UPDATE public.plants SET time_zone=$1',
      ['America/Bogota'],
    )).rejects.toSatisfy(code('42501'));
    await expect(runtimePool.query(
      'UPDATE public.plants SET id=$1 WHERE id=$2',
      [randomUUID(), ids.plant],
    )).rejects.toSatisfy(code('55000'));
  });

  it('blocks a direct metadata forgery even though runtime can update orders', async () => {
    await expect(runtimePool.query(`
      UPDATE public.work_orders SET title='Forged title'
      WHERE organization_id=$1`, [ids.org]))
      .rejects.toSatisfy(code('55000'));
  });
});
