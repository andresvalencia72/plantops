/**
 * Candidate laboratory runtime DML allowlist, NOT approved for production. Schema ownership, DDL, TRIGGER, REFERENCES,
 * TRUNCATE and DELETE on business tables are deliberately never granted.
 * Future tables require a reviewed policy update (fail closed).
 *
 * This module generates statements; it does NOT connect to a database.
 */
export const runtimePermissions = Object.freeze({
  organizations: 'SELECT',
  users: 'SELECT',
  memberships: 'SELECT',
  invitations: 'NONE',
  oidc_accounts: 'NONE',
  oidc_states: 'SELECT, INSERT, DELETE',
  sessions: 'SELECT, INSERT, UPDATE, DELETE',
  assets: 'SELECT, UPDATE',
  plants: 'SELECT, INSERT',
  incidents: 'SELECT, INSERT, UPDATE',
  maintenance_plans: 'SELECT, INSERT, UPDATE',
  work_orders: 'SELECT, INSERT, UPDATE',
  audit_events: 'SELECT, INSERT',
  incident_closures: 'SELECT, INSERT',
  work_order_events: 'SELECT, INSERT',
  work_order_assignments: 'SELECT, INSERT',
  work_order_executions: 'SELECT, INSERT',
  work_order_cancellations: 'SELECT, INSERT',
  maintenance_plan_events: 'SELECT, INSERT',
  asset_plant_assignments: 'SELECT, INSERT',
  asset_plant_transfers: 'SELECT, INSERT',
});

// PostgreSQL SELECT FOR SHARE requires at least one UPDATE column grant.
 // Grant only the primary key and defend it with the 0021 immutability trigger;
 // never grant UPDATE(role/status) on memberships or UPDATE(time_zone) on plants.
export const runtimeLockColumns = Object.freeze({
  memberships: 'id',
  plants: 'id',
});

export function runtimeGrantStatements(role) {
  if (!/^plantops_runtime_[a-z0-9_]{3,48}$/.test(role)) {
    throw new TypeError('Runtime role must have an approved safe identifier');
  }
  const quotedRole = `"${role}"`;
  return [
    `GRANT USAGE ON SCHEMA public TO ${quotedRole}`,
    ...Object.entries(runtimePermissions)
      .filter(([, privileges]) => privileges !== 'NONE')
      .map(([table, privileges]) =>
        `GRANT ${privileges} ON TABLE public."${table}" TO ${quotedRole}`),
    ...Object.entries(runtimeLockColumns).map(([table, column]) =>
      `GRANT UPDATE ("${column}") ON TABLE public."${table}" TO ${quotedRole}`),
  ];
}
