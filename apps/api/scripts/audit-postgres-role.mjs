import { Client } from 'pg';

/** Read-only privilege preflight: never print URLs or credentials. */
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
      has_table_privilege(current_user, c.oid, 'SELECT')
        AS can_select,
      has_table_privilege(current_user, c.oid, 'INSERT')
        AS can_insert,
      has_table_privilege(current_user, c.oid, 'UPDATE')
        AS can_update
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname IN (
        'work_orders', 'assets', 'asset_plant_transfers',
        'work_order_events', 'asset_plant_assignments'
      )
    ORDER BY c.relname
  `);
  const dangerous = [
    role.superuser, role.can_create_roles, role.can_create_databases,
    role.bypasses_rls, role.can_create_in_public,
    tables.some((row) => row.owns_table || row.can_manage_triggers),
  ].some(Boolean);
  const allTables = tables.length === 5;
  const report = {
    role: role.role_name, suitability: dangerous || !allTables
      ? 'NOT_APPROVED' : 'PRIVILEGE_PREFLIGHT_PASS',
    roleCapabilities: {
      superuser: role.superuser,
      canCreateRoles: role.can_create_roles,
      canCreateDatabases: role.can_create_databases,
      bypassesRls: role.bypasses_rls,
      canCreateInPublic: role.can_create_in_public,
    },
    tables,
    caveat: 'Read-only preflight; production grants, RLS and migrations require separate audit',
  };
  console.log(JSON.stringify(report, null, 2));
  if (dangerous || !allTables) process.exitCode = 1;
} catch (error) {
  console.error('PostgreSQL privilege audit failed:', error?.code ?? 'connection_or_sql_error');
  process.exitCode = 2;
} finally {
  await db.end().catch(() => undefined);
}
