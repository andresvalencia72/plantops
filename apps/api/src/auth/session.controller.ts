import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';

/** Authenticated proof endpoint; not an OIDC sign-in or an organization switch. */
@Controller('auth')
export class SessionController {
  @Get('session')
  getSession(@CurrentUser('id') userId: string): { userId: string } {
    return { userId };
  }
}
