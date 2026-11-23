/** Fail closed on misconfigured CSRF/session trusted origins. */
export function trustedOrigins(): string[] {
  const configured = (process.env.SESSION_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set(configured.map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('SESSION_TRUSTED_ORIGINS contains an invalid URL');
    }

    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    const protocolAllowed = parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && local);
    if (!protocolAllowed || parsed.origin !== origin ||
        parsed.username || parsed.password || origin.includes('*')) {
      throw new Error('SESSION_TRUSTED_ORIGINS must contain exact HTTPS origins or local HTTP origins');
    }
    return parsed.origin;
  }))];
}
