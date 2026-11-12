/**
 * Test-only real API server. Refuses non-disposable databases, network hosts,
 * production env and the owner's pilot port. Never print session cookies.
 */
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateLabConfig } from './validate-lab-config.mjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const raw = process.env.DATABASE_TEST_URL;
const destination = process.env.PLANTOPS_ISOLATED_FIXTURE;
validateLabConfig({ raw, destination, cwd: process.cwd() });
process.env.DATABASE_URL = raw;
process.env.PORT = '3002';
delete process.env.SESSION_TRUSTED_ORIGINS;
delete process.env.GOOGLE_OIDC_CLIENT_ID;
delete process.env.GOOGLE_OIDC_CLIENT_SECRET;
delete process.env.MICROSOFT_OIDC_CLIENT_ID;
delete process.env.MICROSOFT_OIDC_CLIENT_SECRET;

const { NestFactory } = await import('@nestjs/core');
const { NodeAdapter } = await import('@nestjs/platform-node');
const { SessionService } = await import('@nestjs/authentication');
const { AppModule } = await import('../dist/app.module.js');
const { users, organizations, memberships } = await import('../dist/database/organizations.js');
const { assets } = await import('../dist/database/assets.js');
const { incidents } = await import('../dist/database/incidents.js');

const pool = new Pool({ connectionString: raw });
const db = drizzle(pool);
const ids = {
  userA: randomUUID(), userB: randomUUID(), supervisorA: randomUUID(),
  technicianA: randomUUID(), technician2A: randomUUID(),
  orgA: randomUUID(), orgB: randomUUID(),
  memberA: randomUUID(), memberB: randomUUID(), supervisorMembershipA: randomUUID(),
  technicianMembershipA: randomUUID(), technicianMembership2A: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
};
let app;
let fixtureWritten = false;

try {
  await migrate(db, { migrationsFolder: resolve('drizzle') });
  await db.insert(users).values([
    { id: ids.userA, displayName: 'Synthetic Reporter A' },
    { id: ids.userB, displayName: 'Synthetic Reporter B' },
    { id: ids.supervisorA, displayName: 'Synthetic Supervisor A' },
    { id: ids.technicianA, displayName: 'Synthetic Technician One' },
    { id: ids.technician2A, displayName: 'Synthetic Technician Two' },
  ]);
  await db.insert(organizations).values([
    { id: ids.orgA, name: 'Synthetic Plant A' },
    { id: ids.orgB, name: 'Synthetic Plant B' },
  ]);
  await db.insert(memberships).values([
    { id: ids.memberA, userId: ids.userA, organizationId: ids.orgA, role: 'MEMBER' },
    { id: ids.memberB, userId: ids.userB, organizationId: ids.orgB, role: 'TECHNICIAN' },
    { id: ids.supervisorMembershipA, userId: ids.supervisorA,
      organizationId: ids.orgA, role: 'SUPERVISOR' },
    { id: ids.technicianMembershipA, userId: ids.technicianA,
      organizationId: ids.orgA, role: 'TECHNICIAN' },
    { id: ids.technicianMembership2A, userId: ids.technician2A,
      organizationId: ids.orgA, role: 'TECHNICIAN' },
  ]);
  await db.insert(assets).values([
    { id: ids.assetA, organizationId: ids.orgA, code: 'LAB-A', name: 'Pump A' },
    { id: ids.assetB, organizationId: ids.orgB, code: 'LAB-B', name: 'Pump B' },
  ]);
  const [foreignIncident] = await db.insert(incidents).values({
    organizationId: ids.orgB, assetId: ids.assetB,
    reportedByMembershipId: ids.memberB,
    title: 'Private synthetic incident B',
    description: 'Must never appear in tenant A',
  }).returning({ id: incidents.id });
  if (!foreignIncident) throw new Error('Cannot seed isolated incident');
  ids.incidentB = foreignIncident.id;
  app = await NestFactory.create(AppModule, new NodeAdapter(), { logger: false });
  app.enableCsrfProtection({ trustedOrigins: [] });
  await app.listen(3002, '127.0.0.1');
  const sessions = app.get(SessionService);
  const cookie = (await sessions.create(ids.userA)).cookie;
  const supervisorCookie = (await sessions.create(ids.supervisorA)).cookie;
  const technicianCookie = (await sessions.create(ids.userB)).cookie;
  await writeFile(destination, JSON.stringify({
    cookie, supervisorCookie, technicianCookie, ...ids,
  }), {
    flag: 'wx', mode: 0o600,
  });
  fixtureWritten = true;
  process.stdout.write('Isolated API ready on port 3002 (synthetic session only)\n');
} catch (error) {
  if (app) await app.close();
  await pool.end();
  throw error;
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  if (fixtureWritten) await unlink(destination).catch(() => {});
  if (app) await app.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
