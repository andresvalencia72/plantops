import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { validateLabConfig } from './validate-lab-config.mjs';

const source = 'postgresql://plantops_test:test-only@127.0.0.1:55433/plantops_s1_test';
const safe = {
  raw: source,
  destination: '/tmp/plantops-isolated-e2e.json',
  cwd: '/home/test/project/apps/api',
  environment: {},
};
const rejects = (change) => assert.throws(
  () => validateLabConfig({ ...safe, ...change }),
);

describe('isolated lab startup gate', () => {
  it('accepts only the dedicated disposable database and fixture', () => {
    assert.equal(validateLabConfig(safe).pathname, '/plantops_s1_test');
    assert.equal(validateLabConfig({
      ...safe,
      raw: 'postgresql://plantops_test:test-only@localhost:5432/plantops_s1_test',
    }).port, '5432');
  });

  it('rejects pilot database, port, host, user and unexpected URL options', () => {
    for (const raw of [
      source.replace('plantops_s1_test', 'plantops_dev'),
      source.replace('55433', '55432'),
      source.replace('127.0.0.1', 'database.example.com'),
      source.replace('plantops_test:test-only', 'plantops_owner:password'),
      source + '?sslmode=disable',
    ]) rejects({ raw });
  });

  it('rejects inherited production or pilot environments', () => {
    rejects({ environment: { NODE_ENV: 'production' } });
    rejects({ environment: { PORT: '3001' } });
    rejects({ environment: { DATABASE_URL: 'postgresql://pilot/plantops_dev' } });
  });

  it('rejects fixture paths outside /tmp or into repository', () => {
    rejects({ destination: '/home/test/project/.env' });
    rejects({ destination: '/tmp/../etc/plantops-try.json' });
    rejects({ destination: '/tmp/session.json' });
  });
});
