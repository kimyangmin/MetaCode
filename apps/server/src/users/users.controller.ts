import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type ApplyImageRequest,
  type AvatarUploadRequest,
  type AvatarUploadTicket,
  type UserDetail,
  type SetCharacterRequest,
  type UserProfile,
  applyImageSchema,
  avatarUploadSchema,
  setCharacterSchema,
  updateProfileSchema,
} from '@metacode/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { UuidParam } from '../common/params.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { UsersService } from './users.service.js';

const searchQuery = z.object({ q: z.string().trim().min(1).max(39) });

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('search')
  search(
    @CurrentUserId() userId: string,
    @Query(new ZodValidationPipe(searchQuery)) query: { q: string },
  ): Promise<UserProfile[]> {
    return this.users.search(userId, query.q);
  }

  @Get('me')
  me(@CurrentUserId() userId: string): Promise<UserDetail> {
    return this.users.getProfile(userId);
  }

  /** 닉네임, 자기소개 바꾸기 */
  @Patch('me')
  update(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: z.output<typeof updateProfileSchema>,
  ): Promise<UserDetail> {
    return this.users.updateProfile(userId, body);
  }

  /** 프로필 사진 올리기 1단계: 원본을 올릴 주소 */
  @Post('me/avatar/upload')
  createAvatarUpload(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(avatarUploadSchema)) body: AvatarUploadRequest,
  ): Promise<AvatarUploadTicket> {
    return this.users.createAvatarUpload(userId, body.size);
  }

  /** 프로필 사진 올리기 2단계: 올린 원본을 확인해 적용한다 (crop: 사용자가 고른 곳) */
  @Put('me/avatar')
  applyAvatar(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(applyImageSchema)) body: ApplyImageRequest,
  ): Promise<UserDetail> {
    return this.users.applyAvatar(userId, body?.crop);
  }

  /** GitHub 사진으로 돌아가기 */
  @Delete('me/avatar')
  removeAvatar(@CurrentUserId() userId: string): Promise<UserDetail> {
    return this.users.removeAvatar(userId);
  }

  /** 광장 캐릭터 고르기 (null이면 기본 캐릭터) */
  @Put('me/character')
  setCharacter(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(setCharacterSchema)) body: SetCharacterRequest,
  ): Promise<UserDetail> {
    return this.users.setCharacter(userId, body.character);
  }

  /** 다른 사람의 프로필 (정보 팝업). 경로가 겹치지 않게 마지막에 둔다 */
  @Get(':id')
  detail(@UuidParam('id') id: string): Promise<UserDetail> {
    return this.users.getProfile(id);
  }
}

const AVATAR_FILE = /^[0-9a-f-]{36}(-animated)?\.webp$/;

/**
 * 프로필 사진 파일. <img>로 바로 쓰도록 인증 없이 준다 (데스크톱 앱의 <img>는 토큰을 붙일 수 없다).
 * 사진을 바꾸면 주소가 바뀌므로 오래 캐시한다.
 */
@Controller('avatars')
export class AvatarsController {
  constructor(private readonly users: UsersService) {}

  @Get(':userId/:file')
  async file(
    @UuidParam('userId') userId: string,
    @Param('file') file: string,
    @Res() res: Response,
  ): Promise<void> {
    const body = AVATAR_FILE.test(file) ? await this.users.readAvatar(userId, file) : null;
    if (!body) throw new NotFoundException();
    res.set({
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(body);
  }
}
