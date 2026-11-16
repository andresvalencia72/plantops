/**
 * Proposed identity-only SQL role, with no general business DML and no ability
 * to CREATE or revoke invitations. For laboratory use, not production grants.
 */
export const identityPermissions = Object.freeze({
  organizations: 'SELECT',
  users: 'SELECT, INSERT',
  memberships: 'SELECT, INSERT',
  invitations: 'SELECT',
  oidc_accounts: 'SELECT, INSERT',
});

export const identityColumnUpdates = Object.freeze({
  invitations: ['consumed_at', 'consumed_by_user_id'],
  oidc_accounts: ['id'], // required for FOR UPDATE, guarded by 0022
  memberships: ['id'], // required for FOR SHARE, guarded by 0021
});

export function identityGrantStatements(role) {
  if (!/^plantops_identity_[a-z0-9_]{3,48}$/.test(role)) {
    throw new TypeError('Identity role must have an approved safe identifier');
  }
  const quoted = `"${role}"`;
  return [
    `GRANT USAGE ON SCHEMA public TO ${quoted}`,
    ...Object.entries(identityPermissions).map(([table, rights]) =>
      `GRANT ${rights} ON TABLE public."${table}" TO ${quoted}`),
    ...Object.entries(identityColumnUpdates).map(([table, columns]) =>
      `GRANT UPDATE (${columns.map((c) => `"${c}"`).join(', ')})
       ON TABLE public."${table}" TO ${quoted}`),
  ];
}
