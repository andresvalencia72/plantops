import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { auditEvents } from '../src/database/audit-events.js';
import { assets } from '../src/database/assets.js';
import { incidents } from '../src/database/incidents.js';
import { memberships, organizations, users } from '../src/database/organizations.js';
import { startIncidentReview } from '../src/incidents/start-incident-review.js';
import { DrizzleMembershipLookup } from '../src/security/drizzle-membership-lookup.js';
import {
  resolveTenantContext, type VerifiedSessionIdentity,
} from '../src/security/tenant-context.js';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL required');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')) {
  throw new Error('Only disposable localhost *_test is allowed');
}

const pool = new Pool({ connectionString: url, max: 24 });
const db = drizzle(pool);
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  assetA: randomUUID(), assetB: randomUUID(),
  superA: randomUUID(), super2A: randomUUID(),
  memberA: randomUUID(), techA: randomUUID(), superB: randomUUID(),
  msA: randomUUID(), ms2A: randomUUID(),
  mmA: randomUUID(), mtA: randomUUID(), msB: randomUUID(),
};

async function context(userId: string, organizationId = ids.orgA) {
  return resolveTenantContext(
    { userId } as VerifiedSessionIdentity, organizationId,
    new DrizzleMembershipLookup(db),
  );
}

async function createIncident(
  organizationId = ids.orgA,
  status: 'REPORTED' | 'UNDER_REVIEW' | 'IN_PROGRESS' | 'CLOSED' = 'REPORTED',
) {
  const [created] = await db.insert(incidents).values({
    organizationId,
    assetId: organizationId === ids.orgA ? ids.assetA : ids.assetB,
    reportedByMembershipId: organizationId === ids.orgA ? ids.msA : ids.msB,
    title: 'Synthetic incident review',
    description: 'Audited incident transition verification',
    status,
  }).returning({ id: incidents.id });
  if (!created) throw new Error('Unable to create fixture incident');
  return created.id;
}

function reviewScope(incidentId: string) {
  return and(eq(auditEvents.organizationId, ids.orgA),
    eq(auditEvents.incidentId, incidentId));
}
async function incidentStatus(id: string) {
  const [row] = await db.select({ status: incidents.status })
    .from(incidents).where(eq(incidents.id, id));
  return row?.status;
}

describe('UC-03: audited review transaction and tenant isolation', () => {
  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await db.insert(users).values([
      ids.superA, ids.super2A, ids.memberA, ids.techA, ids.superB,
    ].map((id) => ({ id, displayName: 'Synthetic ' + id.slice(0, 8) })));
    await db.insert(organizations).values([
      { id: ids.orgA, name: 'Review test tenant A' },
      { id: ids.orgB, name: 'Review test tenant B' },
    ]);
    await db.insert(memberships).values([
      { id: ids.msA, userId: ids.superA, organizationId: ids.orgA, role: 'SUPERVISOR' },
      { id: ids.ms2A, userId: ids.super2A, organizationId: ids.orgA, role: 'SUPERVISOR' },
      { id: ids.mmA, userId: ids.memberA, organizationId: ids.orgA, role: 'MEMBER' },
      { id: ids.mtA, userId: ids.techA, organizationId: ids.orgA, role: 'TECHNICIAN' },
      { id: ids.msB, userId: ids.superB, organizationId: ids.orgB, role: 'SUPERVISOR' },
    ]);
    await db.insert(assets).values([
      { id: ids.assetA, organizationId: ids.orgA, name: 'Review press A', code: 'REV-A' },
      { id: ids.assetB, organizationId: ids.orgB, name: 'Review press B', code: 'REV-B' },
    ]);
  });

  afterAll(async () => { await pool.end(); });

  it('commits exactly one transition and append-only event with server actor', async () => {
    const id = await createIncident();
    const key = randomUUID();
    const result = await startIncidentReview(db, await context(ids.superA), {
      incidentId: id, idempotencyKey: key,
    });
    expect(result).toMatchObject({ id, assetId: ids.assetA, status: 'UNDER_REVIEW' });
    expect(result).not.toHaveProperty('actorMembershipId');
    expect(result).not.toHaveProperty('idempotencyKey');
    const [event] = await db.select().from(auditEvents).where(reviewScope(id));
    expect(event).toMatchObject({
      organizationId: ids.orgA, incidentId: id,
      actorMembershipId: ids.msA, action: 'INCIDENT_REVIEW_STARTED',
      fromStatus: 'REPORTED', toStatus: 'UNDER_REVIEW', idempotencyKey: key,
    });
    expect(event?.occurredAt).toBeInstanceOf(Date);
    await expect(db.update(auditEvents).set({ toStatus: 'CLOSED' })
      .where(eq(auditEvents.id, event!.id))).rejects.toThrow();
    await expect(db.delete(auditEvents)
      .where(eq(auditEvents.id, event!.id))).rejects.toThrow();
  });

  it('replays the same action once and returns its current later state', async () => {
    const id = await createIncident();
    const key = randomUUID();
    const actor = await context(ids.superA);
    const original = await startIncidentReview(db, actor, { incidentId: id, idempotencyKey: key });
    expect((await startIncidentReview(db, actor, {
      incidentId: id, idempotencyKey: key.toUpperCase(),
    })).id).toBe(original.id);
    await db.update(incidents).set({ status: 'IN_PROGRESS' }).where(eq(incidents.id, id));
    expect((await startIncidentReview(db, actor, {
      incidentId: id, idempotencyKey: key,
    })).status).toBe('IN_PROGRESS');
    expect(await db.select().from(auditEvents).where(reviewScope(id))).toHaveLength(1);
  });

  it('denies member, technician, missing tenant and foreign incident', async () => {
    const own = await createIncident();
    const foreign = await createIncident(ids.orgB);
    for (const userId of [ids.memberA, ids.techA]) {
      await expect(startIncidentReview(db, await context(userId), {
        incidentId: own, idempotencyKey: randomUUID(),
      })).rejects.toThrow(ForbiddenException);
    }
    await expect(startIncidentReview(db, await context(ids.superA), {
      incidentId: foreign, idempotencyKey: randomUUID(),
    })).rejects.toThrow(NotFoundException);
    expect(await incidentStatus(own)).toBe('REPORTED');
    expect(await incidentStatus(foreign)).toBe('REPORTED');
  });

  it('rechecks membership ACTIVE and role inside transaction', async () => {
    const stale = await context(ids.superA);
    const id = await createIncident();
    await db.update(memberships).set({ status: 'SUSPENDED' })
      .where(eq(memberships.id, ids.msA));
    try {
      await expect(startIncidentReview(db, stale, {
        incidentId: id, idempotencyKey: randomUUID(),
      })).rejects.toThrow(ForbiddenException);
    } finally {
      await db.update(memberships).set({ status: 'ACTIVE' })
        .where(eq(memberships.id, ids.msA));
    }
    await db.update(memberships).set({ role: 'MEMBER' })
      .where(eq(memberships.id, ids.msA));
    try {
      await expect(startIncidentReview(db, stale, {
        incidentId: id, idempotencyKey: randomUUID(),
      })).rejects.toThrow(ForbiddenException);
    } finally {
      await db.update(memberships).set({ role: 'SUPERVISOR' })
        .where(eq(memberships.id, ids.msA));
    }
    expect(await incidentStatus(id)).toBe('REPORTED');
  });

  it('rejects invalid keys, repeated changed target, and already advanced states', async () => {
    const actor = await context(ids.superA);
    const id = await createIncident();
    await expect(startIncidentReview(db, actor, {
      incidentId: id, idempotencyKey: 'not-uuid',
    })).rejects.toThrow(BadRequestException);
    const key = randomUUID();
    await startIncidentReview(db, actor, { incidentId: id, idempotencyKey: key });
    const different = await createIncident();
    await expect(startIncidentReview(db, actor, {
      incidentId: different, idempotencyKey: key,
    })).rejects.toThrow(ConflictException);
    for (const status of ['UNDER_REVIEW', 'IN_PROGRESS', 'CLOSED'] as const) {
      const otherId = await createIncident(ids.orgA, status);
      await expect(startIncidentReview(db, actor, {
        incidentId: otherId, idempotencyKey: randomUUID(),
      })).rejects.toThrow(ConflictException);
    }
    expect(await incidentStatus(different)).toBe('REPORTED');
  });

  it('twenty concurrent distinct actions yield exactly one winner/event', async () => {
    const id = await createIncident();
    const actorA = await context(ids.superA);
    const actorB = await context(ids.super2A);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) =>
      startIncidentReview(db, index % 2 ? actorA : actorB, {
        incidentId: id, idempotencyKey: randomUUID(),
      })));
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected' &&
      item.reason instanceof ConflictException)).toHaveLength(19);
    expect(await incidentStatus(id)).toBe('UNDER_REVIEW');
    expect(await db.select().from(auditEvents).where(reviewScope(id))).toHaveLength(1);
  });

  it('twenty same-key retries yield one transition and one audit event', async () => {
    const id = await createIncident();
    const key = randomUUID();
    const actor = await context(ids.superA);
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      startIncidentReview(db, actor, { incidentId: id, idempotencyKey: key })));
    expect(results.every((item) => item.id === id &&
      item.status === 'UNDER_REVIEW')).toBe(true);
    expect(await db.select().from(auditEvents).where(reviewScope(id))).toHaveLength(1);
  });

  it('prevents cross-tenant actor and incident links at the SQL constraint boundary', async () => {
    const incidentA = await createIncident();
    const incidentB = await createIncident(ids.orgB);
    const event = {
      organizationId: ids.orgA, incidentId: incidentA,
      actorMembershipId: ids.msA, action: 'INCIDENT_REVIEW_STARTED' as const,
      fromStatus: 'REPORTED' as const, toStatus: 'UNDER_REVIEW' as const,
      idempotencyKey: randomUUID(),
    };
    await expect(db.insert(auditEvents).values({
      ...event, actorMembershipId: ids.msB,
    })).rejects.toThrow();
    await expect(db.insert(auditEvents).values({
      ...event, incidentId: incidentB,
    })).rejects.toThrow();
    await expect(db.insert(auditEvents).values({
      ...event, fromStatus: 'IN_PROGRESS',
    })).rejects.toThrow();
    expect(await db.select().from(auditEvents).where(reviewScope(incidentA))).toHaveLength(0);
  });

  it('concurrent reuse of one key for two incidents commits one and rejects the other', async () => {
    const firstId = await createIncident();
    const secondId = await createIncident();
    const key = randomUUID();
    const actor = await context(ids.superA);
    const results = await Promise.allSettled([firstId, secondId].map((incidentId) =>
      startIncidentReview(db, actor, { incidentId, idempotencyKey: key })));
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected' &&
      item.reason instanceof ConflictException)).toHaveLength(1);
    const statuses = [await incidentStatus(firstId), await incidentStatus(secondId)].sort();
    expect(statuses).toEqual(['REPORTED', 'UNDER_REVIEW']);
    const firstEvents = await db.select().from(auditEvents).where(reviewScope(firstId));
    const secondEvents = await db.select().from(auditEvents).where(reviewScope(secondId));
    expect(firstEvents.length + secondEvents.length).toBe(1);
  });

  it('rolls back the incident when audit persistence is rejected by PostgreSQL', async () => {
    const id = await createIncident();
    const key = randomUUID();
    // Deliberately reject only this synthetic key, never all audit writes.
    await pool.query(`ALTER TABLE audit_events ADD CONSTRAINT test_review_audit_failure
      CHECK (idempotency_key <> '${key}'::uuid)`);
    try {
      await expect(startIncidentReview(db, await context(ids.superA), {
        incidentId: id, idempotencyKey: key,
      })).rejects.toThrow();
      expect(await incidentStatus(id)).toBe('REPORTED');
      expect(await db.select().from(auditEvents).where(reviewScope(id))).toHaveLength(0);
    } finally {
      await pool.query('ALTER TABLE audit_events DROP CONSTRAINT test_review_audit_failure');
    }
  });
});
