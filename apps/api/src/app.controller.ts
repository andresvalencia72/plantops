import { Controller, Get } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Process liveness only. This does not verify a database or a tenant.
  @Public()
  @Get('health')
  getHealth(): { status: 'ok' } {
    return this.appService.getHealth();
  }
}
