/** Read-only evidence for isolated browser E2E; never query the pilot. */
import { Pool } from 'pg';
import { validateLabConfig } from './validate-lab-config.mjs';

const id = process.argv[2];
if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id ?? '')) {
  throw new Error('An incident UUID is required');
}
const raw = process.env.DATABASE_TEST_URL;
validateLabConfig({
  raw, destination: process.env.PLANTOPS_ISOLATED_FIXTURE,
  cwd: process.cwd(),
});

const pool = new Pool({ connectionString: raw, max: 1 });
try {
  const state = await pool.query('SELECT status FROM incidents WHERE id = $1', [id]);
  const events = await pool.query(`
    SELECT action, from_status, to_status
    FROM audit_events WHERE incident_id = $1
  `, [id]);
  process.stdout.write(JSON.stringify({
    status: state.rows[0]?.status ?? null,
    auditCount: events.rowCount,
    validReviewEvents: events.rows.every((event) =>
      event.action === 'INCIDENT_REVIEW_STARTED' &&
      event.from_status === 'REPORTED' && event.to_status === 'UNDER_REVIEW'),
  }));
} finally {
  await pool.end();
}
