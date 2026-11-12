/** UC-05 test-only SQL observation; forbidden for pilot and prod databases. */
import { Pool } from 'pg';
import { validateLabConfig } from './validate-lab-config.mjs';

const orderId = process.argv[2];
if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(orderId ?? '')) {
  throw new Error('Order UUIDv4 required');
}
const url = process.env.DATABASE_TEST_URL;
validateLabConfig({ raw: url,
  destination: process.env.PLANTOPS_ISOLATED_FIXTURE, cwd: process.cwd() });
const pool = new Pool({ connectionString: url, max: 1 });
try {
  const order = await pool.query(`
    SELECT status, assignment_version, responsible_membership_id
    FROM work_orders WHERE id = $1
  `, [orderId]);
  const history = await pool.query(`
    SELECT version, action, from_membership_id, to_membership_id,
      actor_membership_id
    FROM work_order_assignments WHERE work_order_id = $1 ORDER BY version
  `, [orderId]);
  process.stdout.write(JSON.stringify({ current: order.rows[0] ?? null,
    history: history.rows }));
} finally {
  await pool.end();
}
