import { Body, Controller, Get, HttpCode, Put, Query, UseGuards } from '@nestjs/common';
import {
  type MessagePage,
  type MessagesQuery,
  type ReadStateRequest,
  messagesQuerySchema,
  readStateSchema,
} from '@metacode/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { UuidParam } from '../common/params.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MessagesService } from './messages.service.js';

/** 메시지 보내기는 WebSocket(message:send)으로 하고, 기록 조회와 읽음 처리는 HTTP로 한다. */
@Controller('channels')
@UseGuards(AuthGuard)
export class ChannelsController {
  constructor(private readonly messages: MessagesService) {}

  @Get(':id/messages')
  history(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Query(new ZodValidationPipe(messagesQuerySchema)) query: MessagesQuery,
  ): Promise<MessagePage> {
    return this.messages.history(userId, id, query.before, query.limit);
  }

  @Put(':id/read-state')
  @HttpCode(204)
  markRead(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Body(new ZodValidationPipe(readStateSchema)) body: ReadStateRequest,
  ): Promise<void> {
    return this.messages.markRead(userId, id, body.lastReadMessageId);
  }
}
