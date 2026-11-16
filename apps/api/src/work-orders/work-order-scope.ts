import { and, eq, isNull } from 'drizzle-orm';
import { workOrders } from '../database/work-orders.js';

/** An incident-bound corrective command never selects a preventive order. */
export function workOrderScope(
  organizationId: string, orderId: string, incidentId: string | null,
) {
  return and(
    eq(workOrders.organizationId, organizationId),
    eq(workOrders.id, orderId),
    incidentId === null
      ? and(eq(workOrders.kind, 'PREVENTIVE'), isNull(workOrders.incidentId))
      : and(eq(workOrders.kind, 'CORRECTIVE'),
        eq(workOrders.incidentId, incidentId)),
  );
}
