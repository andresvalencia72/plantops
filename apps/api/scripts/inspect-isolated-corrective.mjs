/** Synthetic-only read evidence: no cross-tenant secrets, no pilot connections. */
import { Pool } from 'pg';
import { validateLabConfig } from './validate-lab-config.mjs';

const incidentId = process.argv[2];
if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(incidentId ?? '')) {
  throw new Error('Incident UUIDv4 required');
}
const url = process.env.DATABASE_TEST_URL;
validateLabConfig({
  raw: url, destination: process.env.PLANTOPS_ISOLATED_FIXTURE,
  cwd: process.cwd(),
});
const pool = new Pool({ connectionString: url, max: 1 });
try {
  const incident = await pool.query('SELECT status FROM incidents WHERE id = $1', [incidentId]);
  const result = await pool.query(`
    SELECT w.id, w.title, count(e.id)::int AS events,
      count(e.id) FILTER (WHERE e.from_incident_status = 'UNDER_REVIEW'
        AND e.to_incident_status = 'IN_PROGRESS')::int AS transitions
    FROM work_orders w
    LEFT JOIN work_order_events e ON e.work_order_id = w.id
    WHERE w.incident_id = $1
    GROUP BY w.id, w.title
    ORDER BY w.title
  `, [incidentId]);
  process.stdout.write(JSON.stringify({
    status: incident.rows[0]?.status ?? null,
    orders: result.rows.map((row) => ({
      id: row.id, title: row.title, events: row.events,
      transitions: row.transitions,
    })),
  }));
} finally {
  await pool.end();
}
