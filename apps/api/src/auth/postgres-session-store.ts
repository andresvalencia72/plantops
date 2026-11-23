import type { SessionRecord, SessionStore } from '@nestjs/authentication';
import { and, eq, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sessions } from './sessions.schema.js';

type SessionRow = typeof sessions.$inferSelect;

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastActiveAt: row.lastActiveAt,
    ...(row.mfa ? { mfa: row.mfa } : {}),
    ...(row.metadata ? { metadata: row.metadata } : {}),
  };
}

/**
 * The official NestJS 12 SessionStore contract, backed by the primary DB.
 * Never store the raw cookie token here: SessionService supplies its hash.
 */
export class PostgresSessionStore implements SessionStore {
  constructor(private readonly database: NodePgDatabase) {}

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const [row] = await this.database
      .select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return row ? toSession(row) : undefined;
  }

  async createSession(record: SessionRecord): Promise<void> {
    await this.database.insert(sessions).values({
      id: record.id,
      userId: record.userId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      lastActiveAt: record.lastActiveAt,
      ...(record.mfa ? { mfa: record.mfa } : {}),
      ...(record.metadata ? { metadata: record.metadata } : {}),
    });
  }

  async touchSession(id: string, lastActiveAt: Date): Promise<void> {
    // Atomic and monotonic: never recreate a deleted/revoked session.
    await this.database.update(sessions)
      .set({ lastActiveAt })
      .where(and(eq(sessions.id, id), lt(sessions.lastActiveAt, lastActiveAt)));
  }

  async deleteSession(id: string): Promise<boolean> {
    const removed = await this.database.delete(sessions)
      .where(eq(sessions.id, id)).returning({ id: sessions.id });
    return removed.length > 0;
  }

  async listUserSessions(userId: string): Promise<SessionRecord[]> {
    const records = await this.database.select()
      .from(sessions).where(eq(sessions.userId, userId));
    return records.map(toSession);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.database.delete(sessions).where(eq(sessions.userId, userId));
  }
}
