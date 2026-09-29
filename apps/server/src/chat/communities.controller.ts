import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type ApplyImageRequest,
  type AvatarUploadRequest,
  type AvatarUploadTicket,
  type ChannelSummary,
  type CommunityImageKind,
  type CommunityMember,
  type CommunitySummary,
  type CreateChannelRequest,
  type CreateCommunityRequest,
  type InviteInfo,
  type ReorderRequest,
  type UpdateCommunityRequest,
  applyImageSchema,
  avatarUploadSchema,
  communityImageKindSchema,
  createChannelSchema,
  createCommunitySchema,
  reorderSchema,
  updateCommunitySchema,
} from '@metacode/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { UuidParam } from '../common/params.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CommunitiesService } from './communities.service.js';
import { CommunityProfileService } from './community-profile.service.js';

const inviteCode = z.string().regex(/^[A-Za-z0-9]{4,32}$/);

@Controller()
@UseGuards(AuthGuard)
export class CommunitiesController {
  constructor(
    private readonly communities: CommunitiesService,
    private readonly profile: CommunityProfileService,
  ) {}

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

  /** 이름 바꾸기 (소유자, 관리자) */
  @Patch('communities/:id')
  @HttpCode(204)
  update(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Body(new ZodValidationPipe(updateCommunitySchema)) body: UpdateCommunityRequest,
  ): Promise<void> {
    return this.profile.rename(userId, id, body.name);
  }

  /** 아이콘·배너 올리기 1단계: 원본을 올릴 주소 */
  @Post('communities/:id/images/:kind/upload')
  createImageUpload(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Param('kind', new ZodValidationPipe(communityImageKindSchema)) kind: CommunityImageKind,
    @Body(new ZodValidationPipe(avatarUploadSchema)) body: AvatarUploadRequest,
  ): Promise<AvatarUploadTicket> {
    return this.profile.createUpload(userId, id, kind, body.size);
  }

  /** 아이콘·배너 올리기 2단계: 올린 원본을 확인해 적용한다 */
  @Put('communities/:id/images/:kind')
  @HttpCode(204)
  applyImage(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Param('kind', new ZodValidationPipe(communityImageKindSchema)) kind: CommunityImageKind,
    @Body(new ZodValidationPipe(applyImageSchema)) body: ApplyImageRequest,
  ): Promise<void> {
    return this.profile.apply(userId, id, kind, body?.crop);
  }

  @Delete('communities/:id/images/:kind')
  @HttpCode(204)
  removeImage(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Param('kind', new ZodValidationPipe(communityImageKindSchema)) kind: CommunityImageKind,
  ): Promise<void> {
    return this.profile.remove(userId, id, kind);
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

  @Delete('channels/:id')
  @HttpCode(204)
  deleteChannel(@CurrentUserId() userId: string, @UuidParam('id') id: string): Promise<void> {
    return this.communities.deleteChannel(userId, id);
  }

  @Put('communities/:id/channels/order')
  @HttpCode(204)
  reorderChannels(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Body(new ZodValidationPipe(reorderSchema)) body: ReorderRequest,
  ): Promise<void> {
    return this.communities.reorderChannels(userId, id, body.ids);
  }

  @Delete('communities/:id/members/:userId')
  @HttpCode(204)
  kick(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @UuidParam('userId') targetId: string,
  ): Promise<void> {
    return this.communities.kick(userId, id, targetId);
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

const IMAGE_FILE = /^(icon|banner)-[0-9a-f-]{36}\.webp$/;

/**
 * 커뮤니티 아이콘·배너 파일. 초대 화면(아직 멤버가 아님)과 데스크톱 <img>에서도 쓰도록 인증 없이 준다.
 * 이미지를 바꾸면 주소가 바뀌므로 오래 캐시한다.
 */
@Controller('community-images')
export class CommunityImagesController {
  constructor(private readonly profile: CommunityProfileService) {}

  @Get(':communityId/:file')
  async file(
    @UuidParam('communityId') communityId: string,
    @Param('file') file: string,
    @Res() res: Response,
  ): Promise<void> {
    const body = IMAGE_FILE.test(file) ? await this.profile.read(communityId, file) : null;
    if (!body) throw new NotFoundException();
    res.set({
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(body);
  }
}
