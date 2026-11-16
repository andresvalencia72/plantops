import { Client } from 'pg';
import { runtimeLockColumns, runtimePermissions } from './runtime-role-policy.mjs';

/** Read-only runtime privilege preflight. Never prints URL or credentials. */
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required for read-only role preflight');
  process.exit(2);
}
const db = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 5_000,
});
try {
  await db.connect();
  const { rows: [role] } = await db.query(`
    SELECT current_user AS role_name, r.rolsuper AS superuser,
      r.rolcreaterole AS can_create_roles,
      r.rolcreatedb AS can_create_databases,
      r.rolbypassrls AS bypasses_rls,
      has_schema_privilege(current_user, 'public', 'CREATE')
        AS can_create_in_public
    FROM pg_roles r WHERE r.rolname = current_user
  `);
  const { rows: tables } = await db.query(`
    SELECT c.relname AS table_name,
      pg_get_userbyid(c.relowner) = current_user AS owns_table,
      has_table_privilege(current_user, c.oid, 'TRIGGER')
        AS can_manage_triggers,
      has_table_privilege(current_user, c.oid, 'TRUNCATE')
        AS can_truncate,
      has_table_privilege(current_user, c.oid, 'REFERENCES')
        AS can_reference,
      has_table_privilege(current_user, c.oid, 'SELECT')
        AS can_select,
      has_table_privilege(current_user, c.oid, 'INSERT')
        AS can_insert,
      has_table_privilege(current_user, c.oid, 'UPDATE')
        AS can_update,
      has_table_privilege(current_user, c.oid, 'DELETE')
        AS can_delete
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `);
  const expected = Object.keys(runtimePermissions).sort();
  const actual = tables.map((row) => row.table_name).sort();
  const drift = JSON.stringify(expected) !== JSON.stringify(actual);
  const rightsMismatch = tables.some((row) => {
    const rights = runtimePermissions[row.table_name];
    if (!rights) return true;
    return [
      ['SELECT', row.can_select], ['INSERT', row.can_insert],
      ['UPDATE', row.can_update], ['DELETE', row.can_delete],
    ].some(([name, granted]) =>
      (rights === 'NONE' ? false : rights.split(', ').includes(name)) !== granted);
  });
  let lockDrift = false;
  for (const [table, column] of Object.entries(runtimeLockColumns)) {
    const { rows: [item] } = await db.query(`
      SELECT has_column_privilege(current_user, $1, $2, 'UPDATE')
        AS can_lock_column`, [`public.${table}`, column]);
    if (!item.can_lock_column) lockDrift = true;
  }
  const dangerous = [
    role.superuser, role.can_create_roles, role.can_create_databases,
    role.bypasses_rls, role.can_create_in_public,
    tables.some((row) => row.owns_table || row.can_manage_triggers ||
      row.can_truncate || row.can_reference),
  ].some(Boolean);
  const approved = !dangerous && !drift && !rightsMismatch && !lockDrift;
  const report = {
    role: role.role_name,
    suitability: approved ? 'PRIVILEGE_PREFLIGHT_PASS' : 'NOT_APPROVED',
    roleCapabilities: {
      superuser: role.superuser, canCreateRoles: role.can_create_roles,
      canCreateDatabases: role.can_create_databases,
      bypassesRls: role.bypasses_rls, canCreateInPublic: role.can_create_in_public,
    },
    schemaMatchesManifest: !drift,
    tableDmlMatchesManifest: !rightsMismatch,
    lockColumnGrantsPresent: !lockDrift,
    tables,
    caveat: 'Read-only DDL/DML preflight only. SQL injection, membership privilege escalation and RLS are NOT certified.',
  };
  console.log(JSON.stringify(report, null, 2));
  if (!approved) process.exitCode = 1;
} catch (error) {
  console.error('PostgreSQL privilege audit failed:', error?.code ?? 'connection_or_sql_error');
  process.exitCode = 2;
} finally {
  await db.end().catch(() => undefined);
}
