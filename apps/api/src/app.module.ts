import { Module } from '@nestjs/common';
import { AuthenticationModule } from '@nestjs/authentication';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseConnection } from './auth/database-connection.js';
import { PlantOpsSessionAuth } from './auth/session-auth.provider.js';
import { SessionController } from './auth/session.controller.js';
import { MeController } from './auth/me.controller.js';
import { AssetsController } from './assets/assets.controller.js';
import { IncidentsController } from './incidents/incidents.controller.js';
import { WorkOrdersController } from './work-orders/work-orders.controller.js';
import { TechniciansController } from './work-orders/technicians.controller.js';
import { SessionPersistence } from './auth/session-persistence.js';
import { trustedOrigins } from './auth/trusted-origins.js';
import { buildOidcConfig } from './auth/oidc.config.js';
import { OidcController } from './auth/oidc.controller.js';
import { OidcStatePersistence } from './auth/oidc-state-persistence.js';
import { PlantOpsOidcInviteResolver } from './auth/oidc-invite-resolver.js';

const oidcConfig = buildOidcConfig();

@Module({
  imports: [
    AuthenticationModule.forRoot({
      globalGuard: true,
      allowInMemoryStorage: false,
      ...(oidcConfig ? { oidc: oidcConfig } : {}),
      session: {
        absoluteTtl: '8h',
        idleTtl: '30m',
        touchInterval: '5m',
        trustedOrigins: trustedOrigins(),
        cookie: { secure: true, sameSite: 'lax', path: '/' },
      },
    }),
  ],
  controllers: [
    AppController,
    SessionController,
    MeController,
    AssetsController,
    IncidentsController,
    WorkOrdersController,
    TechniciansController,
    ...(oidcConfig ? [OidcController] : []),
  ],
  providers: [
    AppService,
    DatabaseConnection,
    SessionPersistence,
    PlantOpsSessionAuth,
    ...(oidcConfig ? [OidcStatePersistence, PlantOpsOidcInviteResolver] : []),
  ],
})
export class AppModule {}
