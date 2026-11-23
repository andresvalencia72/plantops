import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  SessionCookieProvider,
  type SessionRecord,
} from '@nestjs/authentication';
import { eq } from 'drizzle-orm';
import { users } from '../database/organizations.js';
import { DatabaseConnection } from './database-connection.js';

type SignedInUser = { id: string; displayName: string };

/** A browser session only authenticates if its user still exists in PostgreSQL. */
@Injectable()
export class PlantOpsSessionAuth extends SessionCookieProvider<SignedInUser> {
  constructor(
    private readonly connection: DatabaseConnection,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerProvider(this);
  }

  protected async validate(session: SessionRecord): Promise<SignedInUser | null> {
    const [user] = await this.connection.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    return user ?? null;
  }
}
