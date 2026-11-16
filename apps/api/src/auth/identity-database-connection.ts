import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/**
 * OIDC resolver only. Separate from the general business DATABASE_URL.
 * Tests and development may share a URL; production MUST use different users.
 */
@Injectable()
export class IdentityDatabaseConnection implements OnModuleDestroy {
  private readonly pool: Pool;
  readonly db: NodePgDatabase;

  constructor() {
    const business = process.env.DATABASE_URL;
    const identity = process.env.IDENTITY_DATABASE_URL?.trim() || undefined;
    if (!business) throw new Error('DATABASE_URL required');
    if (process.env.NODE_ENV === 'production' && !identity) {
      throw new Error('IDENTITY_DATABASE_URL is required in production');
    }
    const businessUrl = new URL(business);
    const identityUrl = new URL(identity ?? business);
    if (!['postgres:', 'postgresql:'].includes(identityUrl.protocol) ||
      !['postgres:', 'postgresql:'].includes(businessUrl.protocol)) {
      throw new Error('Identity and business database must use PostgreSQL');
    }
    // A different database is NOT a separate privilege principal on the
    // same business tables. Prevent accidental credential reuse in production.
    if (process.env.NODE_ENV === 'production' &&
      (identityUrl.username === businessUrl.username ||
       identityUrl.hostname !== businessUrl.hostname ||
       identityUrl.port !== businessUrl.port ||
       identityUrl.pathname !== businessUrl.pathname)) {
      throw new Error('Identity and business require distinct users in the same PostgreSQL database');
    }
    this.pool = new Pool({
      connectionString: identity ?? business, max: 4,
      connectionTimeoutMillis: 5_000,
    });
    this.db = drizzle(this.pool);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
