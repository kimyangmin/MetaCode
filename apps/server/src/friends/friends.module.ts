import { Module } from '@nestjs/common';
import { PresenceModule } from '../presence/presence.module.js';
import { FriendsController } from './friends.controller.js';
import { FriendsService } from './friends.service.js';

/** 친구 요청·수락·끊기 */
@Module({
  imports: [PresenceModule],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
