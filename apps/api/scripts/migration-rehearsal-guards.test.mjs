import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateMigrationRehearsal, migrationPrefix } from './migration-rehearsal-guards.mjs';
const good = 'postgresql://plantops_test:synthetic@127.0.0.1:55433/plantops_s1_test';
const env = { PLANTOPS_MIGRATION_REHEARSAL: 'disposable-only' };

test('accepts only explicit dedicated loopback synthetic DB', () => {
  assert.equal(validateMigrationRehearsal({ raw: good, environment: env }).port, '55433');
  for (const raw of [
    'postgresql://plantops:synthetic@127.0.0.1:55432/plantops_dev',
    'postgresql://plantops_test:synthetic@db.example.com:5432/plantops_s1_test',
    'postgresql://plantops_test:synthetic@127.0.0.1:55433/plantops_prod',
    'postgresql://plantops_test:synthetic@127.0.0.1:5432/postgres',
    'postgresql://plantops_test:synthetic@127.0.0.1:55433/plantops_s1_test?sslmode=require',
  ]) {
    assert.throws(() => validateMigrationRehearsal({ raw, environment: env }));
  }
  for (const environment of [{}, { ...env, NODE_ENV: 'production' },
    { ...env, DATABASE_URL: good }, { PLANTOPS_MIGRATION_REHEARSAL: 'yes' }]) {
    assert.throws(() => validateMigrationRehearsal({ raw: good, environment }));
  }
});

test('requires the original v7 journal and immutable historical boundary', () => {
  const journal = JSON.parse(readFileSync(fileURLToPath(
    new URL('../drizzle/meta/_journal.json', import.meta.url)), 'utf8'));
  const prefix = migrationPrefix(journal);
  assert.equal(prefix.entries.length, 6);
  assert.equal(prefix.entries.at(-1).tag, '0005_adorable_sage');
  assert.throws(() => migrationPrefix({ ...journal, version: '8' }));
  assert.throws(() => migrationPrefix({ ...journal, entries: journal.entries.slice(0, 5) }));
  assert.throws(() => migrationPrefix({ ...journal, entries: [
    { ...journal.entries[0], idx: 3 }, ...journal.entries.slice(1),
  ] }));
});
