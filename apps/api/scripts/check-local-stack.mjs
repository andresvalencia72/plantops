#!/usr/bin/env node
import { Pool } from 'pg';

const expectedTables = [
  'assets',
  'incidents',
  'invitations',
  'memberships',
  'oidc_accounts',
  'oidc_states',
  'organizations',
  'sessions',
  'users',
];

function requireDisposableDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL must be configured privately');
  const url = new URL(raw);
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55432' ||
    url.pathname !== '/plantops_dev' ||
    decodeURIComponent(url.username) !== 'plantops'
  ) {
    throw new Error('Only disposable local plantops_dev is permitted');
  }
  return raw;
}

async function verifyDatabase(connectionString) {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 3_000,
  });
  try {
    const result = await pool.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const tables = new Set(result.rows.map((row) => row.table_name));
    const missing = expectedTables.filter((name) => !tables.has(name));
    if (missing.length) {
      throw new Error('Missing local tables: ' + missing.join(', '));
    }

    const migrations = await pool.query(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    const count = migrations.rows[0]?.count;
    if (typeof count !== 'number' || count < 5) {
      throw new Error('Local Drizzle migrations are incomplete');
    }
    process.stdout.write(
      `PASS PostgreSQL (9 required tables, ${count} applied migrations)\n`,
    );
  } finally {
    await pool.end();
  }
}

async function verifyHttp() {
  const checks = [
    ['/health', 200],
    ['/auth/session', 401],
    ['/me', 401],
    ['/me/organizations', 401],
    ['/organizations/11111111-1111-4111-8111-111111111111/assets', 401],
    ['/auth/oidc/google/login', 404],
    ['/', 404],
  ];
  for (const [path, expected] of checks) {
    const response = await fetch('http://127.0.0.1:3001' + path, {
      redirect: 'manual',
      signal: AbortSignal.timeout(3_000),
    });
    if (response.status !== expected) {
      throw new Error(
        `Unexpected response at ${path}: ${response.status} (wanted ${expected})`,
      );
    }
    if (path === '/health' &&
      JSON.stringify(await response.json()) !== '{"status":"ok"}') {
      throw new Error('Unexpected health response');
    }
    process.stdout.write(`PASS HTTP ${expected} ${path}\n`);
  }
}

try {
  await verifyDatabase(requireDisposableDatabase());
  await verifyHttp();
  process.stdout.write('Local PlantOps stack smoke check passed.\n');
} catch (error) {
  // Never print connection strings or nested database driver errors.
  const message = error instanceof Error && /^(Missing local tables|Local Drizzle migrations|Unexpected response|Unexpected health response|Only disposable local|DATABASE_URL)/.test(error.message)
    ? error.message
    : 'Local PostgreSQL or HTTP service is unavailable';
  process.stderr.write(`FAIL: ${message}\n`);
  process.exitCode = 1;
}
