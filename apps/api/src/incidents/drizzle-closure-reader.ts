import { NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { incidentClosures } from '../database/incident-closures.js';
import { incidents } from '../database/incidents.js';
import type { TenantContext } from '../security/tenant-context.js';
import { incidentClosureCounts } from './incident-closure-counts.js';

/** Advisory counts for UI only. Close command rechecks under FOR UPDATE. */
export class DrizzleClosureReader {
  constructor(private readonly db: NodePgDatabase) {}
  async read(context: TenantContext, incidentId: string) {
    const [incident] = await this.db.select({
      id: incidents.id, status: incidents.status,
    }).from(incidents).where(and(
      eq(incidents.organizationId, context.organizationId),
      eq(incidents.id, incidentId),
    )).limit(1);
    if (!incident) throw new NotFoundException('Incident not found');
    const counts = await incidentClosureCounts(this.db, context.organizationId, incidentId);
    const [closure] = await this.db.select({
      id: incidentClosures.id,
      incidentId: incidentClosures.incidentId,
      actorMembershipId: incidentClosures.actorMembershipId,
      fromStatus: incidentClosures.fromStatus,
      reason: incidentClosures.reason,
      conclusion: incidentClosures.conclusion,
      orderCount: incidentClosures.orderCount,
      completedCount: incidentClosures.completedCount,
      cancelledCount: incidentClosures.cancelledCount,
      closedAt: incidentClosures.closedAt,
    }).from(incidentClosures).where(and(
      eq(incidentClosures.organizationId, context.organizationId),
      eq(incidentClosures.incidentId, incidentId),
    )).limit(1);
    return { status: incident.status, orders: counts, closure: closure ?? null };
  }
}
