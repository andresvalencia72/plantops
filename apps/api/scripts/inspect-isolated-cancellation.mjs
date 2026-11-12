/** Synthetic-only SQL snapshot. No pilot or production database connection. */
import { Pool } from 'pg';
import { validateLabConfig } from './validate-lab-config.mjs';
const orderId = process.argv[2];
if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(orderId ?? '')) {
  throw new Error('UUIDv4 order required');
}
const url = process.env.DATABASE_TEST_URL;
validateLabConfig({ raw: url,
  destination: process.env.PLANTOPS_ISOLATED_FIXTURE, cwd: process.cwd() });
const pool = new Pool({ connectionString: url, max: 1 });
try {
  const order = await pool.query('SELECT status FROM work_orders WHERE id = $1', [orderId]);
  const history = await pool.query(`SELECT id, reason, from_status, actor_membership_id
    FROM work_order_cancellations WHERE work_order_id = $1`, [orderId]);
  process.stdout.write(JSON.stringify({ status: order.rows[0]?.status ?? null,
    events: history.rows }));
} finally { await pool.end(); }
