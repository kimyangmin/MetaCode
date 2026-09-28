import { Module } from '@nestjs/common';
import { AssetsController } from '../assets/assets.controller.js';
import { AssetsService } from '../assets/assets.service.js';
import { AttachmentsController } from '../attachments/attachments.controller.js';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { PlazaService } from '../plaza/plaza.service.js';
import { PresenceModule } from '../presence/presence.module.js';
import { UsersModule } from '../users/users.module.js';
import { LiveKitService } from '../voice/livekit.service.js';
import { VoiceService } from '../voice/voice.service.js';
import { AccessService } from './access.service.js';
import { ChannelSummaryService } from './channel-summary.service.js';
import { ChannelsController } from './channels.controller.js';
import { ChatGateway } from './chat.gateway.js';
import { CommunitiesController } from './communities.controller.js';
import { CommunitiesService } from './communities.service.js';
import { DmsController } from './dms.controller.js';
import { DmsService } from './dms.service.js';
import { MessagesService } from './messages.service.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';

/** 채팅 모드와 메타버스 모드의 서버: 커뮤니티, 채널, DM, 메시지, 첨부, 에셋, 광장, 음성 통화, 실시간 게이트웨이 */
@Module({
  imports: [PresenceModule, UsersModule],
  controllers: [
    CommunitiesController,
    ChannelsController,
    DmsController,
    AttachmentsController,
    RolesController,
    AssetsController,
  ],
  providers: [
    AccessService,
    ChannelSummaryService,
    CommunitiesService,
    DmsService,
    MessagesService,
    RolesService,
    AttachmentsService,
    AssetsService,
    PlazaService,
    LiveKitService,
    VoiceService,
    ChatGateway,
  ],
})
export class ChatModule {}
