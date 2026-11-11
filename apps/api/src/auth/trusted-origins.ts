/** Set exact origins via SESSION_TRUSTED_ORIGINS, never wildcards. */
export function trustedOrigins(): string[] {
  return (process.env.SESSION_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
