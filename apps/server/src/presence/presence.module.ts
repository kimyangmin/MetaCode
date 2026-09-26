import { Module } from '@nestjs/common';
import { PresenceController } from './presence.controller.js';
import { PresenceGateway } from './presence.gateway.js';
import { PresenceService } from './presence.service.js';

@Module({
  controllers: [PresenceController],
  providers: [PresenceService, PresenceGateway],
  exports: [PresenceService],
})
export class PresenceModule {}
