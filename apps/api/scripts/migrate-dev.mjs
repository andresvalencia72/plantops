#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const confirmation = process.argv.slice(2);
if (confirmation.includes('--help')) {
  process.stdout.write(
    'Local DISPOSABLE PostgreSQL only. Usage: npm run db:migrate:dev -- --apply\n' +
    'Requires DATABASE_URL for plantops_dev at 127.0.0.1:55432.\n',
  );
  process.exit(0);
}
if (!confirmation.includes('--apply')) {
  process.stdout.write('Dry run: no migration executed. Pass --apply explicitly.\n');
  process.exit(0);
}
if (confirmation.length !== 1) {
  throw new Error('Only the --apply flag is supported');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const url = new URL(connectionString);
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  url.hostname !== '127.0.0.1' ||
  url.port !== '55432' ||
  url.pathname !== '/plantops_dev' ||
  decodeURIComponent(url.username) !== 'plantops'
) {
  throw new Error('Refusing migration: only local disposable plantops_dev is permitted');
}

const pool = new Pool({ connectionString, connectionTimeoutMillis: 5_000 });
try {
  const database = drizzle(pool);
  await migrate(database, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  process.stdout.write('Local disposable plantops_dev migrations applied.\n');
} finally {
  await pool.end();
}
