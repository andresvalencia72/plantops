import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
  assetId: string;
  title: string;
  description: string;
}>;

function validate(input: ReportIncidentInput) {
  const title = input.title?.trim();
  const description = input.description?.trim();
  const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

  if (
    !uuid.test(input.assetId ?? '') ||
    !title ||
    title.length < 3 ||
    title.length > 160 ||
    !description ||
    description.length < 10 ||
    description.length > 4000
  ) {
    throw new BadRequestException('Invalid incident report');
  }
  return { title, description };
}

/**
 * Internal use case only. Never bind this to HTTP before a real
 * session adapter has verified the identity and tenant membership.
 */
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

    // Check this specific tenant, not merely the asset's global UUID.
    const [asset] = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.id, input.assetId),
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
        ...normalized,
      })
      .returning({
        id: incidents.id,
        organizationId: incidents.organizationId,
        assetId: incidents.assetId,
        status: incidents.status,
        title: incidents.title,
        description: incidents.description,
      });

    return created;
  });
}
