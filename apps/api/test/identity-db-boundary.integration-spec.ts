import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { OidcProfile } from '@nestjs/authentication';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveInvitedIdentity } from '../src/auth/oidc-invite-resolver.js';
import { invitations, oidcAccounts } from '../src/auth/oidc-identity.schema.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { identityGrantStatements } from '../scripts/identity-role-policy.mjs';
import { operatorGrantStatements } from '../scripts/operator-role-policy.mjs';
import { issueInvitation, revokeInvitation } from '../src/auth/invitation-operations.js';
import { runtimeGrantStatements } from '../scripts/runtime-role-policy.mjs';

const raw = process.env.DATABASE_TEST_URL;
if (!raw) throw new Error('DATABASE_TEST_URL required');
const url = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
  !url.pathname.endsWith('_test')) throw new Error('Disposable PostgreSQL only');
const admin = new Pool({ connectionString: raw, max: 8 });
const db = drizzle(admin);
const org = randomUUID();
const roleSuffix = randomUUID().replaceAll('-', '').slice(0, 12);
const businessRole = `plantops_runtime_auth_${roleSuffix}`;
const identityRole = `plantops_identity_lab_${roleSuffix}`;
const operatorRole = `plantops_operator_lab_${roleSuffix}`;
const businessPassword = randomBytes(28).toString('hex');
const identityPassword = randomBytes(28).toString('hex');
const operatorPassword = randomBytes(28).toString('hex');
function rolePool(role: string, password: string) {
  const target = new URL(raw!);
  target.username = role;
  target.password = password;
  return new Pool({ connectionString: target.toString(), max: 7 });
}
const businessPool = rolePool(businessRole, businessPassword);
const identityPool = rolePool(identityRole, identityPassword);
const operatorPool = rolePool(operatorRole, operatorPassword);
const operator = drizzle(operatorPool);
const identity = drizzle(identityPool);
const code = (expected: string) => (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.code === expected || e.cause?.code === expected;
};
function profile(email: string): OidcProfile {
  return {
    provider: 'google', subject: randomUUID(),
    email, emailVerified: true, claims: {}, name: 'Invited teammate',
  };
}
const address = `trusted-${roleSuffix}@example.test`;

describe('Sprint 3Z — independent invite provisioning and identity DB principals', () => {
  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(organizations).values({ id: org, name: 'Identity boundary plantops' });
    for (const [role, password] of [
      [businessRole, businessPassword], [identityRole, identityPassword],
      [operatorRole, operatorPassword],
    ]) {
      await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    }
    for (const statement of [
      ...runtimeGrantStatements(businessRole),
      ...identityGrantStatements(identityRole),
      ...operatorGrantStatements(operatorRole),
    ]) await admin.query(statement);
  });
  afterAll(async () => {
    await businessPool.end(); await identityPool.end(); await operatorPool.end();
    for (const role of [operatorRole, identityRole, businessRole]) {
      await admin.query(`DROP OWNED BY "${role}"`);
      await admin.query(`DROP ROLE "${role}"`);
    }
    await admin.end();
  });

  it('business SQL login cannot forge an invitation, user, membership or account', async () => {
    for (const query of [
      `INSERT INTO invitations(organization_id,email,role,expires_at)
        VALUES ('${org}','fake@example.test','SUPERVISOR',now()+interval '1 day')`,
      `INSERT INTO users(display_name) VALUES ('Fake principal')`,
      `INSERT INTO memberships(organization_id,user_id,role)
        VALUES ('${org}','${randomUUID()}','SUPERVISOR')`,
      `INSERT INTO oidc_accounts(user_id,provider,subject)
        VALUES ('${randomUUID()}','google','forged')`,
    ]) await expect(businessPool.query(query)).rejects.toSatisfy(code('42501'));
    await expect(businessPool.query(
      'SELECT * FROM invitations',
    )).rejects.toSatisfy(code('42501'));
  });

  it('identity SQL login cannot issue/revoke invitations or alter roles', async () => {
    await expect(identityPool.query(`INSERT INTO invitations
      (organization_id,email,role,expires_at)
      VALUES ($1,'forged@example.test','SUPERVISOR',now()+interval '2 days')`,
      [org])).rejects.toSatisfy(code('42501'));
    await expect(identityPool.query(`UPDATE memberships SET role='SUPERVISOR'`))
      .rejects.toSatisfy(code('42501'));
    await expect(identityPool.query(`UPDATE invitations
      SET revoked_at=now()`)).rejects.toSatisfy(code('42501'));
    await expect(identityPool.query(`SELECT * FROM work_orders`))
      .rejects.toSatisfy(code('42501'));
  });

  it('offline operator can provision an invite but cannot mint memberships', async () => {
    const issued = await issueInvitation(operator, {
      organizationId: org, email: address,
      role: 'MEMBER', validDays: 1,
    });
    expect(issued.email).toBe(address);
    await expect(operatorPool.query(
      'INSERT INTO memberships(organization_id,user_id,role) VALUES ($1,$2,$3)',
      [org, randomUUID(), 'SUPERVISOR'],
    )).rejects.toSatisfy(code('42501'));
    await expect(operatorPool.query(
      'SELECT * FROM oidc_accounts',
    )).rejects.toSatisfy(code('42501'));
  });

  it('operator issues invite; identity redeems verified OIDC email and reuses account', async () => {
    const [invite] = await db.select().from(invitations)
      .where(eq(invitations.email, address));
    expect(invite).toBeDefined();
    const source = profile(address);
    const principal = await resolveInvitedIdentity(identity, source, {});
    expect(principal?.id).toBeTruthy();
    expect(await resolveInvitedIdentity(identity, source, {})).toEqual(principal);
    const [joined] = await db.select().from(memberships)
      .where(eq(memberships.userId, principal!.id));
    expect(joined).toMatchObject({ organizationId: org, role: 'MEMBER' });
    const [consumed] = await db.select().from(invitations)
      .where(eq(invitations.id, invite!.id));
    expect(consumed?.consumedByUserId).toBe(principal!.id);
    expect(consumed?.consumedAt).toBeInstanceOf(Date);
    const [account] = await db.select().from(oidcAccounts)
      .where(eq(oidcAccounts.userId, principal!.id));
    expect(account).toMatchObject({
      provider: 'google', subject: source.subject,
    });
    await expect(identityPool.query(
      `UPDATE oidc_accounts SET subject='forged' WHERE id=$1`,
      [account!.id],
    )).rejects.toSatisfy(code('42501'));
    await expect(identityPool.query(
      `UPDATE oidc_accounts SET id=$1 WHERE id=$2`,
      [randomUUID(), account!.id],
    )).rejects.toSatisfy(code('55000'));
  });

  it('refuses a second provider mapping to an already linked account', async () => {
    const [joined] = await db.select().from(invitations)
      .where(eq(invitations.email, address));
    const [account] = await db.select().from(oidcAccounts)
      .where(eq(oidcAccounts.userId, joined!.consumedByUserId!));
    expect(account).toBeDefined();
    const client = await identityPool.connect();
    try {
      await client.query('BEGIN');
      await expect(client.query(
        `INSERT INTO oidc_accounts(user_id,provider,subject)
         VALUES ($1,'microsoft',$2)`,
        [account!.userId, randomUUID()],
      )).rejects.toSatisfy(code('23505'));
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('cannot half-consume or retroactively revoke a consumed invitation', async () => {
    const [consumed] = await db.select().from(invitations)
      .where(eq(invitations.email, address));
    expect(consumed!.consumedAt).not.toBeNull();
    await expect(operatorPool.query(
      'UPDATE invitations SET revoked_at=now() WHERE id=$1',
      [consumed!.id],
    )).rejects.toSatisfy(code('55000'));
    const other = await issueInvitation(operator, {
      organizationId: org, email: `partial-${roleSuffix}@example.test`,
      role: 'MEMBER', validDays: 1,
    });
    await expect(identityPool.query(
      'UPDATE invitations SET consumed_at=now() WHERE id=$1',
      [other.id],
    )).rejects.toSatisfy(code('55000'));
  });

  it('operator can revoke an unconsumed invitation but not edit its role', async () => {
    const created = await issueInvitation(operator, {
      organizationId: org,
      email: `revoke-${roleSuffix}@example.test`,
      role: 'TECHNICIAN', validDays: 1,
    });
    await expect(operatorPool.query(
      `UPDATE invitations SET role='SUPERVISOR' WHERE id=$1`,
      [created.id],
    )).rejects.toSatisfy(code('42501'));
    expect(await revokeInvitation(operator, org, created.id)).toBe(true);
    expect(await revokeInvitation(operator, org, created.id)).toBe(false);
  });

  it('operator cannot retroactively change a pending invitation role or email', async () => {
    const [invite] = await db.insert(invitations).values({
      organizationId: org,
      email: `second-${roleSuffix}@example.test`,
      role: 'MEMBER',
      expiresAt: new Date(Date.now() + 180_000),
    }).returning();
    await expect(admin.query(`UPDATE invitations SET role='SUPERVISOR'
      WHERE id=$1`, [invite!.id])).rejects.toSatisfy(code('55000'));
    await expect(admin.query(`UPDATE invitations
      SET email='altered@example.test' WHERE id=$1`, [invite!.id]))
      .rejects.toSatisfy(code('55000'));
  });

  it('cannot directly mint supervisor membership without a consumed operator invite', async () => {
    const { rows: [fake] } = await identityPool.query<{ id: string }>(
      `INSERT INTO users(display_name) VALUES ('Forged account') RETURNING id`,
    );
    const client = await identityPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO memberships(organization_id,user_id,role)
        VALUES ($1,$2,'SUPERVISOR')`, [org, fake!.id]);
      await expect(client.query('COMMIT')).rejects.toSatisfy(code('55000'));
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const [members] = await db.select().from(memberships)
      .where(eq(memberships.userId, fake!.id));
    expect(members).toBeUndefined();
  });

  it('identity principal cannot fabricate a supervisor invite after redemption', async () => {
    const [person] = await db.select().from(users)
      .where(eq(users.displayName, 'Invited teammate'));
    expect(person).toBeDefined();
    await expect(identityPool.query(`UPDATE invitations
      SET role='SUPERVISOR' WHERE organization_id=$1`, [org]))
      .rejects.toSatisfy(code('42501'));
  });
});
