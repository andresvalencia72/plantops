import {
  BadRequestException, Body, Controller, Get, Header, Headers,
  HttpCode, Param, ParseUUIDPipe, Post, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import { resolveTenantContext, type VerifiedSessionIdentity } from '../security/tenant-context.js';
import { closeIncident } from './close-incident.js';
import { DrizzleClosureReader } from './drizzle-closure-reader.js';

@Controller('organizations/:organizationId/incidents/:incidentId/closure')
export class IncidentClosureController {
  private readonly membership: DrizzleMembershipLookup;
  private readonly reader: DrizzleClosureReader;
  constructor(private readonly connection: DatabaseConnection) {
    this.membership = new DrizzleMembershipLookup(connection.db);
    this.reader = new DrizzleClosureReader(connection.db);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async preview(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
  ) {
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.membership);
    return this.reader.read(context, incidentId);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async close(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' })) incidentId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await resolveTenantContext(
      { userId } as VerifiedSessionIdentity, orgId, this.membership);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Expected reason and optional conclusion');
    }
    const data = body as Record<string, unknown>;
    if (!['reason', 'conclusion,reason'].includes(Object.keys(data).sort().join(',')) ||
      typeof data.reason !== 'string' ||
      (data.conclusion !== undefined && typeof data.conclusion !== 'string')) {
      throw new BadRequestException('Only reason and optional conclusion accepted');
    }
    return closeIncident(this.connection.db, context, {
      incidentId, reason: data.reason, idempotencyKey: key ?? '',
      ...(data.conclusion === undefined ? {} : { conclusion: data.conclusion as string }),
    });
  }
}
