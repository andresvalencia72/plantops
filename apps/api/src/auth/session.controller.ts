import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentUser, SignInService } from '@nestjs/authentication';

/** Authenticated proof endpoint; not an OIDC sign-in or an organization switch. */
@Controller('auth')
export class SessionController {
  constructor(private readonly signIn: SignInService) {}

  @Post('logout')
  @HttpCode(204)
  async logout(): Promise<void> {
    // The global session guard authenticates this request. Nest's CSRF hook
    // rejects cross-origin writes; official signOut discards only this cookie.
    await this.signIn.signOut();
  }

  @Get('session')
  getSession(@CurrentUser('id') userId: string): { userId: string } {
    return { userId };
  }
}
