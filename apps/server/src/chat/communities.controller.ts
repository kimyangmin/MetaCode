import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  type ChannelSummary,
  type CommunityMember,
  type CommunitySummary,
  type CreateChannelRequest,
  type CreateCommunityRequest,
  type InviteInfo,
  createChannelSchema,
  createCommunitySchema,
} from '@metacode/shared';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { UuidParam } from '../common/params.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CommunitiesService } from './communities.service.js';

const inviteCode = z.string().regex(/^[A-Za-z0-9]{4,32}$/);

@Controller()
@UseGuards(AuthGuard)
export class CommunitiesController {
  constructor(private readonly communities: CommunitiesService) {}

  @Post('communities')
  create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createCommunitySchema)) body: CreateCommunityRequest,
  ): Promise<CommunitySummary> {
    return this.communities.create(userId, body.name);
  }

  @Get('communities')
  list(@CurrentUserId() userId: string): Promise<CommunitySummary[]> {
    return this.communities.list(userId);
  }

  @Get('communities/:id/members')
  members(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
  ): Promise<CommunityMember[]> {
    return this.communities.members(userId, id);
  }

  @Post('communities/:id/channels')
  createChannel(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Body(new ZodValidationPipe(createChannelSchema)) body: CreateChannelRequest,
  ): Promise<ChannelSummary> {
    return this.communities.createChannel(userId, id, body);
  }

  @Post('communities/:id/leave')
  @HttpCode(204)
  leave(@CurrentUserId() userId: string, @UuidParam('id') id: string): Promise<void> {
    return this.communities.leave(userId, id);
  }

  @Delete('communities/:id')
  @HttpCode(204)
  remove(@CurrentUserId() userId: string, @UuidParam('id') id: string): Promise<void> {
    return this.communities.remove(userId, id);
  }

  @Post('communities/:id/invites')
  createInvite(@CurrentUserId() userId: string, @UuidParam('id') id: string): Promise<InviteInfo> {
    return this.communities.createInvite(userId, id);
  }

  @Get('invites/:code')
  invite(
    @CurrentUserId() userId: string,
    @Param('code', new ZodValidationPipe(inviteCode)) code: string,
  ): Promise<InviteInfo> {
    return this.communities.inviteInfo(userId, code);
  }

  @Post('invites/:code/accept')
  accept(
    @CurrentUserId() userId: string,
    @Param('code', new ZodValidationPipe(inviteCode)) code: string,
  ): Promise<CommunitySummary> {
    return this.communities.acceptInvite(userId, code);
  }
}
