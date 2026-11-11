import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assets } from '../database/assets.js';
import { incidents } from '../database/incidents.js';
import { memberships } from '../database/organizations.js';
import {
  requireTenantPermission,
  type TenantContext,
} from '../security/tenant-context.js';

export type ReportIncidentInput = Readonly<{
  idempotencyKey: string;
  assetId: string;
  title: string;
  description: string;
}>;

function validate(input: ReportIncidentInput) {
  const title = input.title?.trim();
  const description = input.description?.trim();
  const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
  const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

  if (
    !uuid.test(input.assetId ?? '') ||
    !uuidV4.test(input.idempotencyKey ?? '') ||
    !title ||
    title.length < 3 ||
    title.length > 160 ||
    !description ||
    description.length < 10 ||
    description.length > 4000
  ) {
    throw new BadRequestException('Invalid incident report');
  }
  const assetId = input.assetId.toLowerCase();
  return {
    assetId,
    title,
    description,
    requestHash: createHash('sha256')
      .update(JSON.stringify([assetId, title, description]))
      .digest('hex'),
  };
}

/**
 * Internal use case only. Never bind this to HTTP before a real
 * session adapter has verified the identity and tenant membership.
 */
const projectedReport = {
  id: incidents.id,
  organizationId: incidents.organizationId,
  assetId: incidents.assetId,
  status: incidents.status,
  title: incidents.title,
  description: incidents.description,
  requestHash: incidents.requestHash,
};

function replayReport<T extends { requestHash: string | null }>(
  report: T,
  expectedHash: string,
): Omit<T, 'requestHash'> {
  if (report.requestHash !== expectedHash) {
    throw new ConflictException('Idempotency key reused with different report');
  }
  const { requestHash: _sensitive, ...response } = report;
  void _sensitive;
  return response;
}

export async function reportIncident(
  database: NodePgDatabase,
  context: TenantContext,
  input: ReportIncidentInput,
) {
  requireTenantPermission(context, 'REPORT_INCIDENT');
  const normalized = validate(input);

  return database.transaction(async (tx) => {
    // Lock membership against concurrent suspension or role changes.
    const [member] = await tx
      .select({ id: memberships.id, role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.id, context.membershipId),
          eq(memberships.userId, context.userId),
          eq(memberships.organizationId, context.organizationId),
          eq(memberships.status, 'ACTIVE'),
        ),
      )
      .limit(1)
      .for('share');

    if (!member || member.role !== context.role) {
      throw new ForbiddenException('Membership is no longer active');
    }

    const retryScope = and(
      eq(incidents.organizationId, context.organizationId),
      eq(incidents.reportedByMembershipId, member.id),
      eq(incidents.idempotencyKey, input.idempotencyKey),
    );
    // Fast path: completed retry; no second asset lookup or duplicate insert.
    const [existing] = await tx
      .select(projectedReport)
      .from(incidents)
      .where(retryScope)
      .limit(1);

    if (existing) return replayReport(existing, normalized.requestHash);

    // Check this specific tenant, not merely the asset's global UUID.
    const [asset] = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.id, normalized.assetId),
          eq(assets.organizationId, context.organizationId),
          eq(assets.active, true),
        ),
      )
      .limit(1)
      .for('share');

    if (!asset) throw new NotFoundException('Asset is not available');

    const [created] = await tx
      .insert(incidents)
      .values({
        organizationId: context.organizationId,
        assetId: asset.id,
        reportedByMembershipId: member.id,
        idempotencyKey: input.idempotencyKey,
        title: normalized.title,
        description: normalized.description,
        requestHash: normalized.requestHash,
      })
      .onConflictDoNothing({
        target: [
          incidents.organizationId,
          incidents.reportedByMembershipId,
          incidents.idempotencyKey,
        ],
      })
      .returning(projectedReport);

    if (created) return replayReport(created, normalized.requestHash);

    // READ COMMITTED: a distinct statement sees the winner of a concurrent
    // unique-key conflict after ON CONFLICT DO NOTHING finishes waiting.
    const [winner] = await tx
      .select(projectedReport)
      .from(incidents)
      .where(retryScope)
      .limit(1);
    if (!winner) {
      throw new InternalServerErrorException('Retry outcome could not be resolved');
    }
    return replayReport(winner, normalized.requestHash);
  });
}
