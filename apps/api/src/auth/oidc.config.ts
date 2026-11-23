import {
  google,
  microsoft,
  type OidcOptions,
  type OidcProviderConfig,
} from '@nestjs/authentication';

type Environment = Record<string, string | undefined>;

function clean(input: string | undefined) {
  return input?.trim() ?? '';
}

function callbackOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('OIDC_CALLBACK_ORIGIN must be a valid absolute URL');
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username || url.password || url.search || url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('OIDC_CALLBACK_ORIGIN must be HTTPS (or localhost) without a path');
  }
  return url.origin;
}

/** Empty configuration disables OIDC routes; partial config fails startup. */
export function buildOidcConfig(
  env: Environment = process.env,
): OidcOptions | null {
  const googleId = clean(env.GOOGLE_OIDC_CLIENT_ID);
  const googleSecret = clean(env.GOOGLE_OIDC_CLIENT_SECRET);
  const microsoftId = clean(env.MICROSOFT_OIDC_CLIENT_ID);
  const microsoftSecret = clean(env.MICROSOFT_OIDC_CLIENT_SECRET);
  const microsoftTenant = clean(env.MICROSOFT_OIDC_TENANT_ID);
  const origin = clean(env.OIDC_CALLBACK_ORIGIN);

  const anyGoogle = Boolean(googleId || googleSecret);
  const anyMicrosoft = Boolean(
    microsoftId || microsoftSecret || microsoftTenant,
  );
  if (!anyGoogle && !anyMicrosoft && !origin) return null;
  if (anyGoogle && (!googleId || !googleSecret)) {
    throw new Error('Google OIDC client ID and secret must both be provided');
  }
  if (anyMicrosoft && (!microsoftId || !microsoftSecret || !microsoftTenant)) {
    throw new Error('Microsoft OIDC requires client ID, secret and tenant ID');
  }
  if (anyMicrosoft &&
    !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(microsoftTenant)) {
    throw new Error('Microsoft OIDC tenant must be a tenant-specific UUID');
  }
  if (!anyGoogle && !anyMicrosoft) {
    throw new Error('OIDC_CALLBACK_ORIGIN requires a configured provider');
  }
  if (!origin) throw new Error('OIDC_CALLBACK_ORIGIN must be configured');

  const providers: Record<string, OidcProviderConfig> = {};
  if (anyGoogle) {
    providers.google = google({
      clientId: googleId,
      clientSecret: googleSecret,
    });
  }
  if (anyMicrosoft) {
    providers.microsoft = microsoft({
      tenant: microsoftTenant,
      clientId: microsoftId,
      clientSecret: microsoftSecret,
    });
  }
  return {
    callbackUrl: `${callbackOrigin(origin)}/auth/oidc/:provider/callback`,
    providers,
    transactionTtl: '10m',
    redirectAfterLogin: '/',
  };
}
