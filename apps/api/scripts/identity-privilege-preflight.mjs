import { Client } from 'pg';

/**
 * Read-only, non-secret prerequisite audit. No DDL, grants or mutations.
 * Does not verify the provider's cryptographic OIDC tokens or RLS.
 */
const names = ['DATABASE_URL', 'IDENTITY_DATABASE_URL', 'OPERATOR_DATABASE_URL'];
const missing = names.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.log(JSON.stringify({ status: 'BLOCKED', missingCredentials: missing }));
  process.exit(1);
}

const urls = names.map((name) => new URL(process.env[name]));
const endpoints = urls.map((u) => [u.hostname, u.port || '5432', u.pathname].join(':'));
const usernames = urls.map((u) => u.username);
if (urls.some((u) => !['postgres:', 'postgresql:'].includes(u.protocol)) ||
  new Set(endpoints).size !== 1 || new Set(usernames).size !== 3) {
  console.log(JSON.stringify({
    status: 'BLOCKED', distinctPrincipals: new Set(usernames).size === 3,
    sameDatabase: new Set(endpoints).size === 1,
  }));
  process.exit(1);
}

const clients = [];
try {
  const evidence = {};
  for (const [index, name] of names.entries()) {
    const profile = name === 'DATABASE_URL'
      ? 'business' : name === 'IDENTITY_DATABASE_URL' ? 'identity' : 'operator';
    const client = new Client({
      connectionString: process.env[name], connectionTimeoutMillis: 4_000,
      statement_timeout: 4_000,
    });
    clients.push(client);
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows: [p] } = await client.query(`
      SELECT current_user AS principal,
        r.rolsuper AS superuser,
        r.rolcreaterole AS creates_roles,
        r.rolcreatedb AS creates_databases,
        r.rolbypassrls AS bypasses_rls,
        has_schema_privilege(current_user,'public','CREATE') AS schema_create,
        EXISTS(SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='r'
            AND pg_get_userbyid(c.relowner)=current_user) AS owns_tables,
        has_table_privilege(current_user,'public.invitations','INSERT') AS issues,
        has_table_privilege(current_user,'public.users','INSERT') AS creates_users,
        has_table_privilege(current_user,'public.memberships','INSERT') AS creates_members,
        has_table_privilege(current_user,'public.oidc_accounts','INSERT') AS creates_oidc,
        has_column_privilege(current_user,'public.invitations',
          'consumed_at','UPDATE') AS consumes,
        has_column_privilege(current_user,'public.invitations',
          'revoked_at','UPDATE') AS revokes,
        has_column_privilege(current_user,'public.invitations',
          'role','UPDATE') AS edits_invite_role,
        has_column_privilege(current_user,'public.memberships',
          'role','UPDATE') AS edits_member_role
      FROM pg_roles r WHERE r.rolname=current_user
    `);
    const safe = p.principal === usernames[index] &&
      ![p.superuser, p.creates_roles, p.creates_databases, p.bypasses_rls,
        p.schema_create, p.owns_tables, p.edits_invite_role, p.edits_member_role].some(Boolean);
    const permitted = profile === 'business'
      ? ![p.issues, p.creates_users, p.creates_members, p.creates_oidc,
        p.consumes, p.revokes].some(Boolean)
      : profile === 'identity'
        ? !p.issues && p.creates_users && p.creates_members &&
          p.creates_oidc && p.consumes && !p.revokes
        : p.issues && !p.creates_users && !p.creates_members &&
          !p.creates_oidc && !p.consumes && p.revokes;
    evidence[profile] = { principalDistinct: safe, grantsMatchBoundary: permitted };
    if (profile === 'identity') {
      const { rows: [stats] } = await client.query(`
        SELECT (SELECT count(*)::int FROM (
          SELECT user_id FROM oidc_accounts GROUP BY user_id HAVING count(*)>1
        ) x) AS multiple_accounts,
          (SELECT EXISTS (SELECT 1 FROM pg_constraint
            WHERE conname='oidc_accounts_user_single_identity')) AS unique_identity,
          (SELECT EXISTS (SELECT 1 FROM pg_trigger
            WHERE tgname='oidc_account_original_identity_guard'
              AND tgenabled='O')) AS immutable_accounts,
          (SELECT EXISTS (SELECT 1 FROM pg_trigger
            WHERE tgname='invitations_original_authority_guard'
              AND tgenabled='O')) AS immutable_invitations,
          (SELECT EXISTS (SELECT 1 FROM pg_trigger
            WHERE tgname='memberships_insert_requires_consumed_invitation'
              AND tgenabled='O')) AS consumes_before_membership
      `);
      evidence.schema = {
        noDuplicateAccounts: stats.multiple_accounts === 0,
        uniqueIdentity: stats.unique_identity,
        immutableAccounts: stats.immutable_accounts,
        immutableInvitations: stats.immutable_invitations,
        consumesBeforeMembership: stats.consumes_before_membership,
      };
    }
  }
  const passed = Object.values(evidence).every((section) =>
    Object.values(section).every((value) => value === true));
  console.log(JSON.stringify({
    status: passed ? 'PREFLIGHT_PASS_NOT_DEPLOY_APPROVAL' : 'BLOCKED',
    evidence,
    caveat: 'Read-only ACL and schema check; requires separate human OIDC/RLS and real migration rehearsal',
  }, null, 2));
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.error('Identity preflight could not complete:', error?.code ?? 'DATABASE_UNAVAILABLE');
  process.exitCode = 2;
} finally {
  for (const client of clients) {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
