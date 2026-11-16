/** Offline administrative invitation issuer, never loaded by the HTTP API. */
export function operatorGrantStatements(role) {
  if (!/^plantops_operator_[a-z0-9_]{3,48}$/.test(role)) {
    throw new TypeError('Operator role must have an approved safe identifier');
  }
  const quoted = `"${role}"`;
  return [
    `GRANT USAGE ON SCHEMA public TO ${quoted}`,
    `GRANT SELECT ON TABLE public.organizations TO ${quoted}`,
    `GRANT SELECT, INSERT ON TABLE public.invitations TO ${quoted}`,
    `GRANT UPDATE (revoked_at) ON TABLE public.invitations TO ${quoted}`,
  ];
}
