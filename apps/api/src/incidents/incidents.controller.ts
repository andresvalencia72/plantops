import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnsupportedMediaTypeException,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { DatabaseConnection } from '../auth/database-connection.js';
import { DrizzleMembershipLookup } from '../security/drizzle-membership-lookup.js';
import {
  resolveTenantContext,
  type VerifiedSessionIdentity,
} from '../security/tenant-context.js';
import { DrizzleIncidentReader } from './drizzle-incident-reader.js';
import { reportIncident } from './report-incident.js';
import { startIncidentReview } from './start-incident-review.js';

@Controller('organizations/:organizationId/incidents')
export class IncidentsController {
  private readonly memberships: DrizzleMembershipLookup;
  private readonly incidents: DrizzleIncidentReader;

  constructor(private readonly connection: DatabaseConnection) {
    this.memberships = new DrizzleMembershipLookup(connection.db);
    this.incidents = new DrizzleIncidentReader(connection.db);
  }

  private async scope(userId: string, organizationId: string) {
    // Only the session guard may provide userId. The URL selects, not grants, tenant.
    const identity = { userId } as VerifiedSessionIdentity;
    return resolveTenantContext(identity, organizationId, this.memberships);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async report(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    // No ID, membership, role or organization accepted from the request body.
    // Scope is established from the session and checked again within the TX.
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await this.scope(userId, organizationId);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid incident report body');
    }
    const input = body as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'assetId,description,title' ||
      typeof input.assetId !== 'string' ||
      typeof input.title !== 'string' ||
      typeof input.description !== 'string') {
      throw new BadRequestException('Expected assetId, title and description');
    }
    return reportIncident(this.connection.db, context, {
      idempotencyKey: idempotencyKey ?? '',
      assetId: input.assetId,
      title: input.title,
      description: input.description,
    });
  }

  @Post(':incidentId/review')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async startReview(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' }))
    incidentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ) {
    if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new UnsupportedMediaTypeException('Expected application/json');
    }
    const context = await this.scope(userId, organizationId);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 0) {
      throw new BadRequestException('Expected an empty JSON object');
    }
    return startIncidentReview(this.connection.db, context, {
      incidentId,
      idempotencyKey: idempotencyKey ?? '',
    });
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('assetId') assetId?: string,
  ) {
    const context = await this.scope(userId, organizationId);
    return this.incidents.list(context, limit, cursor, assetId);
  }

  @Get(':incidentId')
  async findById(
    @CurrentUser('id') userId: string,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
    @Param('incidentId', new ParseUUIDPipe({ version: '4' }))
    incidentId: string,
  ) {
    const context = await this.scope(userId, organizationId);
    const incident = await this.incidents.findById(context, incidentId);
    if (!incident) throw new NotFoundException('Incident not found');
    return incident;
  }
}
