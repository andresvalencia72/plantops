import { BadRequestException, Controller, Get, Param, Query, Redirect } from '@nestjs/common';
import { OidcService, Public } from '@nestjs/authentication';

/** OIDC protocol endpoints only; never accept self-signup or email-linking. */
@Public()
@Controller('auth/oidc')
export class OidcController {
  constructor(private readonly oidc: OidcService) {}

  @Get(':provider/login')
  @Redirect()
  login(
    @Param('provider') provider: string,
    @Query('redirectTo') redirectTo?: string,
  ) {
    // Dynamic post-login redirects have not been reviewed; fail closed.
    // The server-side redirectAfterLogin setting remains a trusted constant.
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
