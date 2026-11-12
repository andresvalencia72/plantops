#!/usr/bin/env node
/** Historical incident/review schema -> current UC-08 schema, without pilot access. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { migrationPrefix, validateMigrationRehearsal } from './migration-rehearsal-guards.mjs';

// Validate before opening a network connection or touching a database.
const target = validateMigrationRehearsal({ raw: process.env.DATABASE_TEST_URL });
const folder = fileURLToPath(new URL('../drizzle', import.meta.url));
const journal = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8'));
const prefix = migrationPrefix(journal);
const staging = await mkdtemp(join(tmpdir(), 'plantops-rehearsal-'));
const db = new Pool({ connectionString: target.href,
  connectionTimeoutMillis: 3_000, max: 3 });
const ids = {
  organizationA: randomUUID(), organizationB: randomUUID(),
  supervisor: randomUUID(), technician: randomUUID(),
  membershipA: randomUUID(), membershipB: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
  incidentLegacy: randomUUID(), incidentNewer: randomUUID(),
  incidentCross: randomUUID(),
};

async function assertPristine() {
  const { rows } = await db.query(`SELECT count(*)::integer AS n
    FROM pg_catalog.pg_tables
    WHERE schemaname IN ('public','drizzle')`);
  if (rows[0]?.n !== 0) {
    throw new Error('Refusing rehearsal on a database with existing tables');
  }
}

async function seedHistoricalRecords() {
  await db.query('INSERT INTO organizations (id,name) VALUES ($1,$2),($3,$4)',
    [ids.organizationA, 'Synthetic Alpha', ids.organizationB, 'Synthetic Beta']);
  await db.query('INSERT INTO users (id,display_name) VALUES ($1,$2),($3,$4)',
    [ids.supervisor, 'Synthetic supervisor', ids.technician, 'Synthetic technician']);
  await db.query(`INSERT INTO memberships
    (id,organization_id,user_id,role) VALUES
    ($1,$2,$3,'SUPERVISOR'),($4,$5,$6,'TECHNICIAN')`,
  [ids.membershipA, ids.organizationA, ids.supervisor,
    ids.membershipB, ids.organizationB, ids.technician]);
  await db.query('INSERT INTO assets (id,organization_id,code,name) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',
    [ids.assetA, ids.organizationA, 'A-01', 'Legacy pump',
      ids.assetB, ids.organizationB, 'B-01', 'Foreign pump']);
  // Old rows had nullable idempotency keys and existing review evidence.
  await db.query(`INSERT INTO incidents
    (id,organization_id,asset_id,reported_by_membership_id,title,description,status)
    VALUES ($1,$2,$3,$4,'Older incident','Preexisting row','UNDER_REVIEW')`,
  [ids.incidentLegacy, ids.organizationA, ids.assetA, ids.membershipA]);
  await db.query(`INSERT INTO incidents
    (id,organization_id,asset_id,reported_by_membership_id,idempotency_key,
      request_hash,title,description,status)
    VALUES ($1,$2,$3,$4,$5,$6,'Recent report','Existing client key','REPORTED')`,
  [ids.incidentNewer, ids.organizationA, ids.assetA, ids.membershipA,
    randomUUID(), 'test-existing-key']);
  await db.query(`INSERT INTO incidents
    (id,organization_id,asset_id,reported_by_membership_id,title,description)
    VALUES ($1,$2,$3,$4,'Foreign incident','Tenant B record')`,
  [ids.incidentCross, ids.organizationB, ids.assetB, ids.membershipB]);
  await db.query(`INSERT INTO audit_events
    (organization_id,incident_id,actor_membership_id,action,from_status,to_status,idempotency_key)
    VALUES ($1,$2,$3,'INCIDENT_REVIEW_STARTED','REPORTED','UNDER_REVIEW',$4)`,
  [ids.organizationA, ids.incidentLegacy, ids.membershipA, randomUUID()]);
}

async function verifyUpgrade() {
  const rows = await db.query(`SELECT id, organization_id, status, idempotency_key,
    request_hash FROM incidents ORDER BY id`);
  assert.equal(rows.rows.length, 3, 'Historical incident rows must survive');
  const older = rows.rows.find((item) => item.id === ids.incidentLegacy);
  assert.deepEqual([older?.organization_id, older?.status,
    older?.idempotency_key, older?.request_hash],
  [ids.organizationA, 'UNDER_REVIEW', null, null]);
  assert.equal(rows.rows.find((item) => item.id === ids.incidentNewer)?.request_hash,
    'test-existing-key');
  assert.equal(rows.rows.find((item) => item.id === ids.incidentCross)?.organization_id,
    ids.organizationB);
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM audit_events'))
    .rows[0].n, 1, 'Historic review evidence must remain');

  const expected = ['work_orders', 'work_order_events', 'work_order_assignments',
    'work_order_executions', 'work_order_cancellations', 'incident_closures'];
  const tables = await db.query(`SELECT tablename FROM pg_catalog.pg_tables
    WHERE schemaname='public' AND tablename = ANY($1)`, [expected]);
  assert.equal(tables.rows.length, expected.length, 'All new tables must exist');
  const triggers = await db.query(`SELECT c.relname, t.tgname
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE t.tgisinternal=false AND t.tgenabled <> 'D' AND
    c.relname=ANY($1)`, [['audit_events', ...expected]]);
  for (const name of ['audit_events', 'work_order_events',
    'work_order_assignments', 'work_order_executions',
    'work_order_cancellations', 'incident_closures']) {
    assert(triggers.rows.some((item) => item.relname === name &&
      item.tgname.endsWith('reject_changes')), `Missing audit trigger on ${name}`);
  }
  const fks = await db.query(`SELECT conname FROM pg_constraint WHERE conname=ANY($1)`, [[
    'work_order_incident_asset_tenant_fk', 'work_order_responsible_tenant_fk',
    'work_order_execution_actor_tenant_fk',
    'incident_closure_incident_tenant_fk',
  ]]);
  assert.equal(fks.rows.length, 4, 'Critical tenant foreign keys must exist');

  const key = randomUUID();
  const result = await db.query(`INSERT INTO work_orders (organization_id,
    incident_id,asset_id,created_by_membership_id,idempotency_key,request_hash,
    title,description) VALUES ($1,$2,$3,$4,$5,$6,'Synthetic work order',
    'An order on an old incident') RETURNING status,assignment_version`,
  [ids.organizationA, ids.incidentLegacy, ids.assetA,
    ids.membershipA, key, 'test-new-order']);
  assert.deepEqual(result.rows[0], { status: 'PENDING', assignment_version: 0 });
  await assert.rejects(db.query(`INSERT INTO work_orders (organization_id,
    incident_id,asset_id,created_by_membership_id,idempotency_key,request_hash,
    title,description) VALUES ($1,$2,$3,$4,$5,$6,'Cross tenant',
    'This must fail the composite foreign key')`,
  [ids.organizationB, ids.incidentLegacy, ids.assetB,
    ids.membershipB, randomUUID(), 'cross-tenant']),
  (err) => err?.code === '23503', 'Cross-tenant order creation must fail');
}

try {
  await mkdir(join(staging, 'meta'), { recursive: true });
  await writeFile(join(staging, 'meta/_journal.json'),
    JSON.stringify(prefix), { mode: 0o600 });
  for (const { tag } of prefix.entries) {
    await cp(join(folder, `${tag}.sql`), join(staging, `${tag}.sql`));
  }
  await assertPristine();
  const driver = drizzle(db);
  await migrate(driver, { migrationsFolder: staging });
  await seedHistoricalRecords();
  await migrate(driver, { migrationsFolder: folder });
  await verifyUpgrade();
  // Important: incremental migrations must be idempotent on a second run.
  await migrate(driver, { migrationsFolder: folder });
  assert.equal((await db.query(`SELECT count(*)::integer AS n
    FROM drizzle.__drizzle_migrations`)).rows[0].n,
  journal.entries.length, 'Each schema migration must be recorded exactly once');
  process.stdout.write(`PASS: ${prefix.entries.length} legacy migrations → ` +
    `${journal.entries.length} current, 3 incidents and review evidence preserved; ` +
    'tenant constraints, audit triggers and rerun validated.\n');
} finally {
  await db.end();
  await rm(staging, { recursive: true, force: true });
  // Intentional: database cleanup is the disposable PostgreSQL container's job.
}
