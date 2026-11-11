import { describe, expect, it } from 'vitest';
import { buildOidcConfig } from './oidc.config.js';

describe('OIDC configuration', () => {
  it('leaves OIDC disabled rather than exposing an unusable login', () => {
    expect(buildOidcConfig({})).toBeNull();
  });

  it('rejects partial provider configuration', () => {
    expect(() => buildOidcConfig({
      GOOGLE_OIDC_CLIENT_ID: 'client',
    })).toThrow('Google OIDC');
    expect(() => buildOidcConfig({
      MICROSOFT_OIDC_CLIENT_ID: 'client',
      MICROSOFT_OIDC_CLIENT_SECRET: 'secret',
    })).toThrow('Microsoft OIDC');
  });

  it('requires explicit HTTPS callback origin and never trusts a Host header', () => {
    const base = {
      GOOGLE_OIDC_CLIENT_ID: 'client',
      GOOGLE_OIDC_CLIENT_SECRET: 'secret',
    };
    expect(() => buildOidcConfig({
      ...base, OIDC_CALLBACK_ORIGIN: 'http://plantops.example',
    })).toThrow('HTTPS');
    expect(() => buildOidcConfig({
      ...base, OIDC_CALLBACK_ORIGIN: 'https://plantops.example/evil',
    })).toThrow('HTTPS');
    expect(buildOidcConfig({
      ...base, OIDC_CALLBACK_ORIGIN: 'https://plantops.example',
    })?.callbackUrl).toBe('https://plantops.example/auth/oidc/:provider/callback');
  });

  it('supports explicit local callback and only registered Google provider', () => {
    const configuration = buildOidcConfig({
      GOOGLE_OIDC_CLIENT_ID: 'google-client',
      GOOGLE_OIDC_CLIENT_SECRET: 'secret',
      OIDC_CALLBACK_ORIGIN: 'http://localhost:3001',
    });
    expect(Object.keys(configuration!.providers)).toEqual(['google']);
    expect(configuration!.transactionTtl).toBe('10m');
  });

  it('requires tenant-specific Microsoft Entra ID, not common', () => {
    const base = {
      MICROSOFT_OIDC_CLIENT_ID: 'client',
      MICROSOFT_OIDC_CLIENT_SECRET: 'secret',
      OIDC_CALLBACK_ORIGIN: 'https://plantops.example',
    };
    expect(() => buildOidcConfig({
      ...base, MICROSOFT_OIDC_TENANT_ID: 'common',
    })).toThrow('tenant-specific UUID');
    const configured = buildOidcConfig({
      ...base,
      MICROSOFT_OIDC_TENANT_ID: 'da15c0de-cafe-4789-9b1a-123456789abc',
    });
    expect(Object.keys(configured!.providers)).toEqual(['microsoft']);
  });
});
