import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { type PresenceQuery, type PresenceResponse, presenceQuerySchema } from '@metacode/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PresenceService } from './presence.service.js';

@Controller('presence')
@UseGuards(AuthGuard)
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get()
  get(
    @Query(new ZodValidationPipe(presenceQuerySchema)) query: PresenceQuery,
  ): Promise<PresenceResponse> {
    return this.presence.getOnline(query.userIds);
  }
}
