import { Module } from '@nestjs/common';
import { PresenceController } from './presence.controller.js';
import { PresenceService } from './presence.service.js';

/** 온라인 상태 기록과 조회. 연결 처리는 chat/chat.gateway.ts가 한다. */
@Module({
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
