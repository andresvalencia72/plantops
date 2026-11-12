import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { incidentClosures } from '../database/incident-closures.js';
import { incidents } from '../database/incidents.js';
import { memberships } from '../database/organizations.js';
import { requireTenantPermission, type TenantContext } from '../security/tenant-context.js';
import { incidentClosureCounts } from './incident-closure-counts.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export type CloseIncidentInput = Readonly<{
  incidentId: string; reason: string; conclusion?: string;
  idempotencyKey: string;
}>;
const fields = {
  id: incidentClosures.id, incidentId: incidentClosures.incidentId,
  actorMembershipId: incidentClosures.actorMembershipId,
  fromStatus: incidentClosures.fromStatus,
  reason: incidentClosures.reason, conclusion: incidentClosures.conclusion,
  orderCount: incidentClosures.orderCount,
  completedCount: incidentClosures.completedCount,
  cancelledCount: incidentClosures.cancelledCount,
  closedAt: incidentClosures.closedAt,
  requestHash: incidentClosures.requestHash,
};
function normalize(input: CloseIncidentInput) {
  const incidentId = input.incidentId?.toLowerCase();
  const key = input.idempotencyKey?.toLowerCase();
  const reason = input.reason?.trim();
  const conclusion = input.conclusion?.trim() || null;
  if (!uuidV4.test(incidentId) || !uuidV4.test(key) || !reason ||
    reason.length < 10 || reason.length > 1000 ||
    (conclusion !== null && (conclusion.length < 20 || conclusion.length > 4000))) {
    throw new BadRequestException('Invalid incident closure');
  }
  const requestHash = createHash('sha256')
    .update(JSON.stringify([incidentId, reason, conclusion])).digest('hex');
  return { incidentId, key, reason, conclusion, requestHash };
}
function visible<T extends { requestHash: string }>(event: T, hash: string) {
  if (event.requestHash !== hash) {
    throw new ConflictException('Closure key used for different content');
  }
  const { requestHash: _internal, ...data } = event;
  void _internal;
  return data;
}

/** UC-08: lock identical parent incident row used by UC-04 order creation. */
export async function closeIncident(db: NodePgDatabase,
  context: TenantContext, input: CloseIncidentInput) {
  requireTenantPermission(context, 'CLOSE_INCIDENT');
  const next = normalize(input);
  return db.transaction(async (tx) => {
    const [actor] = await tx.select({ role: memberships.role })
      .from(memberships).where(and(
        eq(memberships.organizationId, context.organizationId),
        eq(memberships.id, context.membershipId),
        eq(memberships.userId, context.userId),
        eq(memberships.status, 'ACTIVE'),
      )).limit(1).for('share');
    if (!actor || actor.role !== 'SUPERVISOR' || actor.role !== context.role) {
      throw new ForbiddenException('Active supervisor required');
    }
    const scope = and(eq(incidents.organizationId, context.organizationId),
      eq(incidents.id, next.incidentId));
    // New work-order creation first takes this same lock (UC-04).
    const [incident] = await tx.select({ id: incidents.id, status: incidents.status })
      .from(incidents).where(scope).limit(1).for('update');
    if (!incident) throw new NotFoundException('Incident not found');
    const retryScope = and(
      eq(incidentClosures.organizationId, context.organizationId),
      eq(incidentClosures.actorMembershipId, context.membershipId),
      eq(incidentClosures.idempotencyKey, next.key),
    );
    const [prior] = await tx.select(fields).from(incidentClosures)
      .where(retryScope).limit(1);
    if (prior) return visible(prior, next.requestHash);

    const counts = await incidentClosureCounts(tx, context.organizationId, incident.id);
    if (counts.total === 0) {
      if (incident.status !== 'UNDER_REVIEW' || next.conclusion !== null) {
        throw new ConflictException('No-order closure requires review and a reason only');
      }
    } else if (incident.status !== 'IN_PROGRESS' || counts.open !== 0 ||
      !next.conclusion || next.conclusion.length < 20) {
      throw new ConflictException('All work orders must be terminal and a conclusion supplied');
    }

    const [event] = await tx.insert(incidentClosures).values({
      organizationId: context.organizationId, incidentId: incident.id,
      actorMembershipId: context.membershipId,
      fromStatus: incident.status === 'UNDER_REVIEW' ? 'UNDER_REVIEW' : 'IN_PROGRESS',
      reason: next.reason, conclusion: next.conclusion,
      orderCount: counts.total, completedCount: counts.completed,
      cancelledCount: counts.cancelled,
      idempotencyKey: next.key, requestHash: next.requestHash,
    }).onConflictDoNothing({ target: [
      incidentClosures.organizationId,
      incidentClosures.actorMembershipId,
      incidentClosures.idempotencyKey,
    ] }).returning(fields);
    if (!event) {
      const [winner] = await tx.select(fields).from(incidentClosures)
        .where(retryScope).limit(1);
      if (!winner) throw new InternalServerErrorException('Closure retry unresolved');
      return visible(winner, next.requestHash);
    }
    const [closed] = await tx.update(incidents).set({ status: 'CLOSED' })
      .where(and(scope, eq(incidents.status, incident.status)))
      .returning({ id: incidents.id });
    if (!closed) throw new InternalServerErrorException('Incident closure lost its lock');
    return visible(event, next.requestHash);
  });
}
