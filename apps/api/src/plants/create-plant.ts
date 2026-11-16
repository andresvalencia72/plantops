import {
  BadRequestException, ConflictException, ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { postgresTextLengthIsBetween } from '../common/postgres-text-length.js';
import { memberships } from '../database/organizations.js';
import { plants } from '../database/plants.js';
import { resolvePlantTimeZone } from '../maintenance-plans/industrial-calendar.js';
import { requireTenantPermission, type TenantContext } from '../security/tenant-context.js';
import { plantFields } from './plant-reader.js';

export type CreatePlantInput = Readonly<{ name: string; timeZone: string }>;

/** Natural-key replay: same tenant/name/zone returns the same plant. */
export async function createPlant(
  db: NodePgDatabase, context: TenantContext, input: CreatePlantInput,
) {
  requireTenantPermission(context, 'CREATE_PLANT');
  const name = input.name?.trim();
  if (!name || !postgresTextLengthIsBetween(name, 3, 160)) {
    throw new BadRequestException('Invalid plant name');
  }
  let timeZone: string;
  try {
    timeZone = resolvePlantTimeZone(input.timeZone);
  } catch {
    throw new BadRequestException('Invalid IANA plant time zone');
  }
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
    const registered = await tx.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_timezone_names WHERE name = ${timeZone}
      ) AS found
    `);
    if (registered.rows[0]?.found !== true) {
      throw new BadRequestException('Unknown PostgreSQL IANA time zone');
    }

    const [created] = await tx.insert(plants).values({
      organizationId: context.organizationId, name, timeZone,
    }).onConflictDoNothing({ target: [
      plants.organizationId, plants.name,
    ] }).returning(plantFields);
    if (created) return created;

    const [prior] = await tx.select(plantFields).from(plants)
      .where(and(eq(plants.organizationId, context.organizationId),
        eq(plants.name, name))).limit(1);
    if (!prior) throw new InternalServerErrorException('Plant conflict unresolved');
    if (prior.timeZone !== timeZone) {
      throw new ConflictException('Plant name belongs to another time zone');
    }
    return prior;
  });
}
