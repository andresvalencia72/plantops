import { and, eq, sql } from 'drizzle-orm';
import { workOrders } from '../database/work-orders.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** Pure aggregate, after caller holds incident FOR UPDATE for mutations. */
export async function incidentClosureCounts(db: NodePgDatabase,
  organizationId: string, incidentId: string) {
  const [counts] = await db.select({
    total: sql<number>`count(*)::integer`,
    completed: sql<number>`count(*) FILTER (
      WHERE ${workOrders.status} = 'COMPLETED')::integer`,
    cancelled: sql<number>`count(*) FILTER (
      WHERE ${workOrders.status} = 'CANCELLED')::integer`,
  }).from(workOrders).where(and(
    eq(workOrders.organizationId, organizationId),
    eq(workOrders.incidentId, incidentId),
  ));
  const total = Number(counts?.total ?? 0);
  const completed = Number(counts?.completed ?? 0);
  const cancelled = Number(counts?.cancelled ?? 0);
  return { total, completed, cancelled, open: total - completed - cancelled };
}
