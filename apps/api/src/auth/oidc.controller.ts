import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Query,
  Redirect,
} from '@nestjs/common';
import { OidcService, Public } from '@nestjs/authentication';
import { buildOidcConfig } from './oidc.config.js';

/** OIDC protocol endpoints only; never accept self-signup or email-linking. */
@Public()
@Controller('auth/oidc')
export class OidcController {
  constructor(private readonly oidc: OidcService) {}

  /** Public names only, never configuration values or client credentials. */
  @Get('providers')
  providers(): { providers: string[] } {
    const enabled = buildOidcConfig();
    return { providers: enabled && typeof enabled.providers === 'object'
      ? Object.keys(enabled.providers) : [] };
  }

  @Get(':provider/login')
  @Redirect()
  login(
    @Param('provider') provider: string,
    @Query('redirectTo') redirectTo?: string,
  ) {
    // Account linking is intentionally unavailable until reviewed.
    return this.oidc.start(provider, { redirectTo });
  }

  @Get(':provider/callback')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Redirect()
  async callback(
    @Param('provider') provider: string,
    @Query() query: Record<string, string>,
  ) {
    try {
      return await this.oidc.finish(provider, query);
    } catch (error) {
      // Only the expected invite-only denial may navigate to a safe UI.
      // State, token, replay, issuer and other security failures stay errors.
      if (error instanceof ForbiddenException &&
        error.message === 'account not allowed') {
        return {
          url: '/?source=api&auth=access-denied',
          statusCode: 303,
        };
      }
      throw error;
    }
  }
}
