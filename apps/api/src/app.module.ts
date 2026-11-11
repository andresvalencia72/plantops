import { Module } from '@nestjs/common';
import { AuthenticationModule } from '@nestjs/authentication';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseConnection } from './auth/database-connection.js';
import { PlantOpsSessionAuth } from './auth/session-auth.provider.js';
import { SessionController } from './auth/session.controller.js';
import { SessionPersistence } from './auth/session-persistence.js';
import { trustedOrigins } from './auth/trusted-origins.js';

@Module({
  imports: [
    AuthenticationModule.forRoot({
      globalGuard: true,
      allowInMemoryStorage: false,
      session: {
        absoluteTtl: '8h',
        idleTtl: '30m',
        touchInterval: '5m',
        trustedOrigins: trustedOrigins(),
        cookie: { secure: true, sameSite: 'lax', path: '/' },
      },
    }),
  ],
  controllers: [AppController, SessionController],
  providers: [
    AppService,
    DatabaseConnection,
    SessionPersistence,
    PlantOpsSessionAuth,
  ],
})
export class AppModule {}
