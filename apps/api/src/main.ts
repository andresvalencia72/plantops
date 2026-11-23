import { NestFactory } from '@nestjs/core';
import { NodeAdapter } from '@nestjs/platform-node';
import { AppModule } from './app.module.js';
import { trustedOrigins } from './auth/trusted-origins.js';

async function bootstrap() {
  const port = Number(process.env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const app = await NestFactory.create(AppModule, new NodeAdapter());
  app.enableCsrfProtection({ trustedOrigins: trustedOrigins() });
  // This API remains bound to loopback until deployment is designed.
  await app.listen(port, '127.0.0.1');
}
await bootstrap();
