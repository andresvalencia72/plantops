import {
  BadRequestException, ConflictException, ForbiddenException,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { auditEvents } from '../database/audit-events.js';
import { incidents } from '../database/incidents.js';
import { memberships } from '../database/organizations.js';
import {
  requireTenantPermission, type TenantContext,
} from '../security/tenant-context.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

const incidentDetail = {
  id: incidents.id,
  assetId: incidents.assetId,
  title: incidents.title,
  description: incidents.description,
  status: incidents.status,
  reportedAt: incidents.reportedAt,
};

export type StartIncidentReviewInput = Readonly<{
  incidentId: string;
  idempotencyKey: string;
}>;

/** UC-03: state change and audit event either commit together or neither does. */
export async function startIncidentReview(
  database: NodePgDatabase,
  context: TenantContext,
  input: StartIncidentReviewInput,
) {
  requireTenantPermission(context, 'START_INCIDENT_REVIEW');
  if (!uuidV4.test(input.incidentId) || !uuidV4.test(input.idempotencyKey)) {
    throw new BadRequestException('Expected incident UUIDv4 and Idempotency-Key UUIDv4');
  }

  return database.transaction(async (tx) => {
    const [membership] = await tx.select({ role: memberships.role })
      .from(memberships)
      .where(and(
        eq(memberships.id, context.membershipId),
        eq(memberships.userId, context.userId),
        eq(memberships.organizationId, context.organizationId),
        eq(memberships.status, 'ACTIVE'),
      ))
      .limit(1)
      .for('share');

    if (!membership || membership.role !== context.role ||
        membership.role !== 'SUPERVISOR') {
      throw new ForbiddenException('Supervisor membership is no longer active');
    }

    // Serialize independent supervisor actions on this specific tenant incident.
    const target = and(
      eq(incidents.organizationId, context.organizationId),
      eq(incidents.id, input.incidentId),
    );
    const [incident] = await tx.select(incidentDetail).from(incidents)
      .where(target).limit(1).for('update');
    if (!incident) throw new NotFoundException('Incident not found');

    const retryScope = and(
      eq(auditEvents.organizationId, context.organizationId),
      eq(auditEvents.actorMembershipId, context.membershipId),
      eq(auditEvents.action, 'INCIDENT_REVIEW_STARTED'),
      eq(auditEvents.idempotencyKey, input.idempotencyKey),
    );
    const [previous] = await tx.select({ incidentId: auditEvents.incidentId })
      .from(auditEvents).where(retryScope).limit(1);
    if (previous) {
      if (previous.incidentId !== incident.id) {
        throw new ConflictException('Idempotency key belongs to another incident');
      }
      return incident;
    }
    if (incident.status !== 'REPORTED') {
      throw new ConflictException('Only REPORTED incidents can enter review');
    }

    // Unique index arbitrates simultaneous reuse of one key on distinct
    // incidents. If this insert fails, the status is never changed.
    const [inserted] = await tx.insert(auditEvents).values({
      organizationId: context.organizationId,
      incidentId: incident.id,
      actorMembershipId: context.membershipId,
      action: 'INCIDENT_REVIEW_STARTED',
      fromStatus: 'REPORTED',
      toStatus: 'UNDER_REVIEW',
      idempotencyKey: input.idempotencyKey,
    }).onConflictDoNothing({
      target: [
        auditEvents.organizationId, auditEvents.actorMembershipId,
        auditEvents.action, auditEvents.idempotencyKey,
      ],
    }).returning({ id: auditEvents.id });
    if (!inserted) {
      // The other transaction committed a differently scoped event;
      // abort the entire TX, never claim a second transition succeeded.
      throw new ConflictException('Idempotency key reused for another incident');
    }

    const [updated] = await tx.update(incidents)
      .set({ status: 'UNDER_REVIEW' })
      .where(and(target, eq(incidents.status, 'REPORTED')))
      .returning(incidentDetail);
    if (!updated) {
      // Also rolls back the already inserted audit row.
      throw new InternalServerErrorException('Incident review update lost its lock');
    }
    return updated;
  });
}
