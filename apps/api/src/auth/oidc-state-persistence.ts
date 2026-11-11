import { Injectable } from '@nestjs/common';
import { AuthenticationStorage } from '@nestjs/authentication';
import { DatabaseConnection } from './database-connection.js';
import { PostgresOidcStateStore } from './postgres-oidc-state.store.js';

/** Never use a process-local OIDC state store with multiple API instances. */
@Injectable()
export class OidcStatePersistence {
  constructor(
    connection: DatabaseConnection,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({
      oidcStates: new PostgresOidcStateStore(connection.db),
    });
  }
}
