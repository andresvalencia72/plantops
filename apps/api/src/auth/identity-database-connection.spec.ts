import { afterEach, describe, expect, it } from 'vitest';
import { IdentityDatabaseConnection } from './identity-database-connection.js';

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  IDENTITY_DATABASE_URL: process.env.IDENTITY_DATABASE_URL,
};
const put = (name: 'NODE_ENV' | 'DATABASE_URL' | 'IDENTITY_DATABASE_URL',
  value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};
afterEach(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    put(name as 'NODE_ENV' | 'DATABASE_URL' | 'IDENTITY_DATABASE_URL', value);
  }
});

const business = 'postgresql://plantops_runtime_abcd:dummy@127.0.0.1:5432/plantops_db';
const identity = 'postgresql://plantops_identity_abcd:dummy2@127.0.0.1:5432/plantops_db';

describe('isolated identity pool configuration', () => {
  it('fails closed when production lacks the identity credential', () => {
    put('NODE_ENV', 'production'); put('DATABASE_URL', business);
    put('IDENTITY_DATABASE_URL', undefined);
    expect(() => new IdentityDatabaseConnection())
      .toThrow('IDENTITY_DATABASE_URL is required');
  });

  it('rejects the same DB principal even with a second URL', () => {
    put('NODE_ENV', 'production'); put('DATABASE_URL', business);
    put('IDENTITY_DATABASE_URL', business);
    expect(() => new IdentityDatabaseConnection())
      .toThrow('distinct users');
  });

  it('rejects separate DB targets that do not isolate the same tenant schema', () => {
    put('NODE_ENV', 'production'); put('DATABASE_URL', business);
    put('IDENTITY_DATABASE_URL', identity.replace('/plantops_db', '/other_db'));
    expect(() => new IdentityDatabaseConnection())
      .toThrow('same PostgreSQL database');
  });

  it('accepts distinct principals on the same DB without opening a connection', async () => {
    put('NODE_ENV', 'production'); put('DATABASE_URL', business);
    put('IDENTITY_DATABASE_URL', identity);
    const connection = new IdentityDatabaseConnection();
    expect(connection.db).toBeDefined();
    await connection.onModuleDestroy();
  });

  it('permits a shared connection only in explicit non-production tests', async () => {
    put('NODE_ENV', 'test'); put('DATABASE_URL', business);
    put('IDENTITY_DATABASE_URL', undefined);
    const connection = new IdentityDatabaseConnection();
    await connection.onModuleDestroy();
  });
});
