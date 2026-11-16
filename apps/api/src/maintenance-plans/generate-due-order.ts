import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException,
  InternalServerErrorException, NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assets } from '../database/assets.js';
import { maintenancePlans } from '../database/maintenance-plans.js';
import { memberships } from '../database/organizations.js';
import { plants } from '../database/plants.js';
import { workOrderEvents } from '../database/work-order-events.js';
import { workOrders } from '../database/work-orders.js';
import { requireTenantPermission, type TenantContext } from '../security/tenant-context.js';
import { isDueOnLocalDay } from './industrial-calendar.js';

const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const visible = {
  id: workOrders.id,
  kind: workOrders.kind,
  incidentId: workOrders.incidentId,
  maintenancePlanId: workOrders.maintenancePlanId,
  scheduledFor: workOrders.scheduledFor,
  assetId: workOrders.assetId,
  title: workOrders.title,
  description: workOrders.description,
  status: workOrders.status,
  responsibleMembershipId: workOrders.responsibleMembershipId,
  assignmentVersion: workOrders.assignmentVersion,
  createdAt: workOrders.createdAt,
  requestHash: workOrders.requestHash,
};

function publicOrder<T extends { requestHash: string;
  maintenancePlanId: string | null }>(row: T, hash: string, planId: string) {
  if (row.requestHash !== hash || row.maintenancePlanId !== planId) {
    throw new ConflictException('Retry key already belongs to another operation');
  }
  const { requestHash: _private, ...result } = row;
  void _private;
  return result;
}

/** Explicit supervisor action: one due calendar slot, never a cron job. */
export async function generateDueOrder(
  db: NodePgDatabase, context: TenantContext,
  input: Readonly<{ planId: string; idempotencyKey: string }>,
  asOfUtc: Date = new Date(),
) {
  requireTenantPermission(context, 'GENERATE_MAINTENANCE_ORDER');
  if (!Number.isFinite(asOfUtc.getTime())) {
    throw new InternalServerErrorException('Clock is unavailable');
  }
  const planId = input.planId?.toLowerCase();
  const key = input.idempotencyKey?.toLowerCase();
  if (!uuidV4.test(planId) || !uuidV4.test(key)) {
    throw new BadRequestException('Invalid plan or idempotency key');
  }
  const requestHash = createHash('sha256')
    .update(JSON.stringify(['GENERATE_MAINTENANCE_ORDER', planId]))
    .digest('hex');
  return db.transaction(async (tx) => {
    const [actor] = await tx.select({ role: memberships.role })
      .from(memberships).where(and(
        eq(memberships.organizationId, context.organizationId),
        eq(memberships.id, context.membershipId),
        eq(memberships.userId, context.userId),
        eq(memberships.status, 'ACTIVE'),
      )).limit(1).for('share');
    if (actor?.role !== 'SUPERVISOR' || actor.role !== context.role) {
      throw new ForbiddenException('Active supervisor required');
    }

    const planScope = and(
      eq(maintenancePlans.organizationId, context.organizationId),
      eq(maintenancePlans.id, planId),
    );
    const [plan] = await tx.select({
      id: maintenancePlans.id, assetId: maintenancePlans.assetId,
      title: maintenancePlans.title,
      description: maintenancePlans.description,
      nextDueOn: maintenancePlans.nextDueOn,
      intervalDays: maintenancePlans.intervalDays,
      active: maintenancePlans.active,
    }).from(maintenancePlans).where(planScope).limit(1).for('update');
    if (!plan) throw new NotFoundException('Maintenance plan not found');

    // The plan row lock serializes generation and all exact retries.
    const retryScope = and(
      eq(workOrders.organizationId, context.organizationId),
      eq(workOrders.createdByMembershipId, context.membershipId),
      eq(workOrders.idempotencyKey, key),
    );
    const [prior] = await tx.select(visible).from(workOrders)
      .where(retryScope).limit(1);
    if (prior) return publicOrder(prior, requestHash, plan.id);

    if (!plan.active) throw new ConflictException('Plan is inactive');
    const [asset] = await tx.select({
      id: assets.id, plantId: assets.plantId,
    }).from(assets).where(and(
      eq(assets.organizationId, context.organizationId),
      eq(assets.id, plan.assetId), eq(assets.active, true),
    )).limit(1).for('share');
    if (!asset) throw new NotFoundException('Active asset not found');

    // The asset's tenant-safe plant link is the trusted source of local
    // calendar semantics. Legacy unassigned assets retain UTC until linked.
    let isDue = plan.nextDueOn <= asOfUtc.toISOString().slice(0, 10);
    if (asset.plantId !== null) {
      const [plant] = await tx.select({ zone: plants.timeZone })
        .from(plants).where(and(
          eq(plants.organizationId, context.organizationId),
          eq(plants.id, asset.plantId),
        )).limit(1).for('share');
      if (!plant) throw new InternalServerErrorException('Linked plant unavailable');
      try {
        isDue = isDueOnLocalDay(plan.nextDueOn, plant.zone, asOfUtc);
      } catch {
        throw new InternalServerErrorException('Plant time zone unsupported');
      }
    }
    if (!isDue) throw new ConflictException('Maintenance plan is not due');

    const [created] = await tx.insert(workOrders).values({
      organizationId: context.organizationId,
      kind: 'PREVENTIVE', incidentId: null,
      assetId: asset.id, maintenancePlanId: plan.id,
      scheduledFor: plan.nextDueOn,
      createdByMembershipId: context.membershipId,
      idempotencyKey: key, requestHash,
      title: plan.title, description: plan.description,
    }).onConflictDoNothing().returning(visible);
    if (!created) {
      throw new ConflictException('Due occurrence already exists');
    }
    await tx.insert(workOrderEvents).values({
      organizationId: context.organizationId,
      workOrderId: created.id,
      actorMembershipId: context.membershipId,
      action: 'WORK_ORDER_CREATED',
    });
    const [advanced] = await tx.update(maintenancePlans).set({
      nextDueOn: sql<string>`${maintenancePlans.nextDueOn} + (${plan.intervalDays}::integer)`,
      version: sql<number>`${maintenancePlans.version} + 1`,
    }).where(and(planScope, eq(maintenancePlans.nextDueOn, plan.nextDueOn)))
      .returning({ id: maintenancePlans.id });
    if (!advanced) {
      throw new InternalServerErrorException('Plan advancement lost its lock');
    }
    return publicOrder(created, requestHash, plan.id);
  });
}
