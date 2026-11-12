/** Rehearsal must never connect to the pilot, production or an unknown DB. */
export function validateMigrationRehearsal({ raw, environment = process.env }) {
  if (environment.PLANTOPS_MIGRATION_REHEARSAL !== 'disposable-only' ||
      environment.NODE_ENV === 'production' || environment.DATABASE_URL) {
    throw new Error('Rehearsal must be explicit and isolated from runtime DATABASE_URL');
  }
  if (!raw) throw new Error('DATABASE_TEST_URL required for rehearsal');
  let url;
  try { url = new URL(raw); }
  catch { throw new Error('Invalid rehearsal PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !['5432', '55433'].includes(url.port) ||
      url.pathname !== '/plantops_s1_test' ||
      url.username !== 'plantops_test' || !url.password ||
      url.search || url.hash) {
    throw new Error('Only dedicated loopback plantops_s1_test is permitted');
  }
  return url;
}

/** Verify prefix is exactly the historical journal, without changing migrations. */
export function migrationPrefix(journal, lastIdx = 5) {
  if (journal?.version !== '7' || journal.dialect !== 'postgresql' ||
      !Array.isArray(journal.entries) || journal.entries.length < lastIdx + 2) {
    throw new Error('Unknown migration journal; refuse upgrade rehearsal');
  }
  const entries = journal.entries.slice(0, lastIdx + 1);
  if (entries.some((item, idx) => item.idx !== idx ||
      !/^\d{4}_[a-z0-9_]+$/.test(item.tag))) {
    throw new Error('Migration prefix is not contiguous');
  }
  if (entries.at(-1)?.tag !== '0005_adorable_sage') {
    throw new Error('Historical review schema boundary changed');
  }
  return { version: journal.version, dialect: journal.dialect, entries };
}
