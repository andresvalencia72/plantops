import { afterEach, describe, expect, it } from 'vitest';
import { trustedOrigins } from './trusted-origins.js';

const original = process.env.SESSION_TRUSTED_ORIGINS;
afterEach(() => {
  if (original === undefined) delete process.env.SESSION_TRUSTED_ORIGINS;
  else process.env.SESSION_TRUSTED_ORIGINS = original;
});

describe('SESSION_TRUSTED_ORIGINS', () => {
  it('defaults to no trusted origins', () => {
    delete process.env.SESSION_TRUSTED_ORIGINS;
    expect(trustedOrigins()).toEqual([]);
  });

  it('permits exact HTTPS origins and loopback-only HTTP', () => {
    process.env.SESSION_TRUSTED_ORIGINS =
      'https://app.example.test, http://localhost:5173, https://app.example.test';
    expect(trustedOrigins()).toEqual([
      'https://app.example.test',
      'http://localhost:5173',
    ]);
  });

  it.each([
    '*',
    'https://*.example.test',
    'https://app.example.test/path',
    'https://app.example.test/',
    'https://name:pass@app.example.test',
    'http://app.example.test',
    'null',
    'file:///tmp',
  ])('rejects non-exact or unsafe origin %s', (invalid) => {
    process.env.SESSION_TRUSTED_ORIGINS = invalid;
    expect(() => trustedOrigins()).toThrow();
  });
});
