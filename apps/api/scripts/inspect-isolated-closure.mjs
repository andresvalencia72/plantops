/** Read-only synthetic closure inspection, rejects pilot/production DBs. */
import { Pool } from 'pg';
import { validateLabConfig } from './validate-lab-config.mjs';
const id = process.argv[2];
if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id ?? '')) {
  throw new Error('Incident UUIDv4 required');
}
const url = process.env.DATABASE_TEST_URL;
validateLabConfig({ raw: url,
  destination: process.env.PLANTOPS_ISOLATED_FIXTURE, cwd: process.cwd() });
const pool = new Pool({ connectionString: url, max: 1 });
try {
  const incident = await pool.query('SELECT status FROM incidents WHERE id = $1', [id]);
  const closure = await pool.query(`SELECT id, reason, conclusion, order_count,
    completed_count, cancelled_count, from_status FROM incident_closures
    WHERE incident_id = $1`, [id]);
  const orders = await pool.query(`SELECT status, count(*)::integer AS count
    FROM work_orders WHERE incident_id = $1 GROUP BY status ORDER BY status`, [id]);
  process.stdout.write(JSON.stringify({ status: incident.rows[0]?.status ?? null,
    events: closure.rows, orders: orders.rows }));
} finally { await pool.end(); }
