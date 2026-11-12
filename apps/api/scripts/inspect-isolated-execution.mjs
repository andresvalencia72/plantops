/** Read-only SQL evidence from disposable *_test DB; rejects the pilot. */
import { Pool } from 'pg';
import { validateLabConfig } from './validate-lab-config.mjs';
const orderId = process.argv[2];
if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(orderId ?? '')) {
  throw new Error('UUIDv4 work order required');
}
const url = process.env.DATABASE_TEST_URL;
validateLabConfig({ raw: url,
  destination: process.env.PLANTOPS_ISOLATED_FIXTURE, cwd: process.cwd() });
const pool = new Pool({ connectionString: url, max: 1 });
try {
  const order = await pool.query(`SELECT status, responsible_membership_id
    FROM work_orders WHERE id = $1`, [orderId]);
  const actions = await pool.query(`SELECT action, from_status, to_status, result,
    actor_membership_id FROM work_order_executions WHERE work_order_id = $1
    ORDER BY occurred_at, id`, [orderId]);
  process.stdout.write(JSON.stringify({ current: order.rows[0] ?? null,
    events: actions.rows }));
} finally { await pool.end(); }
