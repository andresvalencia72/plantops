import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assets } from '../database/assets.js';
import { maintenancePlans } from '../database/maintenance-plans.js';
import { memberships } from '../database/organizations.js';
import { requireTenantPermission, type TenantContext } from '../security/tenant-context.js';
import { isUtcCalendarDay } from './utc-calendar-day.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export type CreateMaintenancePlanInput = Readonly<{
  assetId: string; title: string; description: string;
  intervalDays: number; nextDueOn: string; idempotencyKey: string;
}>;

const projection = {
  id: maintenancePlans.id,
  assetId: maintenancePlans.assetId,
  title: maintenancePlans.title,
  description: maintenancePlans.description,
  intervalDays: maintenancePlans.intervalDays,
  nextDueOn: maintenancePlans.nextDueOn,
  active: maintenancePlans.active,
  version: maintenancePlans.version,
  createdAt: maintenancePlans.createdAt,
  requestHash: maintenancePlans.requestHash,
};

function normalize(input: CreateMaintenancePlanInput) {
  const assetId = input.assetId?.toLowerCase();
  const idempotencyKey = input.idempotencyKey?.toLowerCase();
  const title = input.title?.trim();
  const description = input.description?.trim();
  const firstDue = input.nextDueOn;
  if (!uuidV4.test(assetId) || !uuidV4.test(idempotencyKey) ||
    !title || title.length < 3 || title.length > 160 ||
    !description || description.length < 10 || description.length > 4000 ||
    !Number.isInteger(input.intervalDays) ||
    input.intervalDays < 1 || input.intervalDays > 365 ||
    !isUtcCalendarDay(firstDue)) {
    throw new BadRequestException('Invalid maintenance plan');
  }
  const requestHash = createHash('sha256').update(JSON.stringify([
    'MAINTENANCE_PLAN', assetId, title, description, input.intervalDays, firstDue,
  ])).digest('hex');
  return { assetId, idempotencyKey, title, description,
    intervalDays: input.intervalDays, nextDueOn: firstDue, requestHash };
}

function publicPlan<T extends { requestHash: string }>(row: T, hash: string) {
  if (row.requestHash !== hash) {
    throw new ConflictException('Retry key already belongs to a different plan');
  }
  const { requestHash: _hash, ...visible } = row;
  void _hash;
  return visible;
}

export async function createMaintenancePlan(
  db: NodePgDatabase, context: TenantContext, input: CreateMaintenancePlanInput,
) {
  requireTenantPermission(context, 'CREATE_MAINTENANCE_PLAN');
  const plan = normalize(input);
  return db.transaction(async (tx) => {
    const [actor] = await tx.select({ role: memberships.role }).from(memberships)
      .where(and(eq(memberships.organizationId, context.organizationId),
        eq(memberships.id, context.membershipId),
        eq(memberships.userId, context.userId),
        eq(memberships.status, 'ACTIVE'))).limit(1).for('share');
    if (actor?.role !== 'SUPERVISOR' || actor.role !== context.role) {
      throw new ForbiddenException('Active supervisor required');
    }
    const retryScope = and(
      eq(maintenancePlans.organizationId, context.organizationId),
      eq(maintenancePlans.createdByMembershipId, context.membershipId),
      eq(maintenancePlans.idempotencyKey, plan.idempotencyKey),
    );
    const [prior] = await tx.select(projection).from(maintenancePlans)
      .where(retryScope).limit(1);
    if (prior) return publicPlan(prior, plan.requestHash);

    const [asset] = await tx.select({ id: assets.id }).from(assets)
      .where(and(eq(assets.organizationId, context.organizationId),
        eq(assets.id, plan.assetId), eq(assets.active, true)))
      .limit(1).for('share');
    if (!asset) throw new NotFoundException('Active asset not found');
    const [created] = await tx.insert(maintenancePlans).values({
      organizationId: context.organizationId, assetId: asset.id,
      createdByMembershipId: context.membershipId,
      title: plan.title, description: plan.description,
      intervalDays: plan.intervalDays, nextDueOn: plan.nextDueOn,
      idempotencyKey: plan.idempotencyKey, requestHash: plan.requestHash,
    }).onConflictDoNothing({ target: [
      maintenancePlans.organizationId, maintenancePlans.createdByMembershipId,
      maintenancePlans.idempotencyKey,
    ] }).returning(projection);
    if (!created) {
      const [winner] = await tx.select(projection).from(maintenancePlans)
        .where(retryScope).limit(1);
      if (!winner) throw new InternalServerErrorException('Plan retry not resolved');
      return publicPlan(winner, plan.requestHash);
    }
    return publicPlan(created, plan.requestHash);
  });
}
