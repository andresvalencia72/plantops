import { BadRequestException, Controller, Get, Param, Query, Redirect } from '@nestjs/common';
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
    // Redirect destination is configured server-side; never supplied by client.
    if (redirectTo !== undefined) {
      throw new BadRequestException('Custom OIDC redirect is not enabled');
    }
    return this.oidc.start(provider);
  }

  @Get(':provider/callback')
  @Redirect()
  callback(
    @Param('provider') provider: string,
    @Query() query: Record<string, string>,
  ) {
    return this.oidc.finish(provider, query);
  }
}
