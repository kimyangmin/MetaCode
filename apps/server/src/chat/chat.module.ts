import { Module } from '@nestjs/common';
import { PresenceModule } from '../presence/presence.module.js';
import { AccessService } from './access.service.js';
import { ChannelSummaryService } from './channel-summary.service.js';
import { ChannelsController } from './channels.controller.js';
import { ChatGateway } from './chat.gateway.js';
import { CommunitiesController } from './communities.controller.js';
import { CommunitiesService } from './communities.service.js';
import { DmsController } from './dms.controller.js';
import { DmsService } from './dms.service.js';
import { MessagesService } from './messages.service.js';

/** 채팅 모드: 커뮤니티, 채널, DM, 메시지, 실시간 게이트웨이 */
@Module({
  imports: [PresenceModule],
  controllers: [CommunitiesController, ChannelsController, DmsController],
  providers: [
    AccessService,
    ChannelSummaryService,
    CommunitiesService,
    DmsService,
    MessagesService,
    ChatGateway,
  ],
})
export class ChatModule {}
