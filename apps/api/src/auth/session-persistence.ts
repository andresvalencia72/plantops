import { Injectable } from '@nestjs/common';
import { AuthenticationStorage } from '@nestjs/authentication';
import { DatabaseConnection } from './database-connection.js';
import { PostgresSessionStore } from './postgres-session-store.js';

/** Registers only PostgreSQL session storage; no in-memory fallback. */
@Injectable()
export class SessionPersistence {
  constructor(
    connection: DatabaseConnection,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({
      sessions: new PostgresSessionStore(connection.db),
    });
  }
}
