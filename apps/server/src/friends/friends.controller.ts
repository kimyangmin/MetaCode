import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import {
  type FriendChanged,
  type FriendsList,
  type SendFriendRequest,
  sendFriendRequestSchema,
} from '@metacode/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { UuidParam } from '../common/params.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FriendsService } from './friends.service.js';

@Controller('friends')
@UseGuards(AuthGuard)
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  /** 친구, 받은 요청, 보낸 요청 */
  @Get()
  list(@CurrentUserId() userId: string): Promise<FriendsList> {
    return this.friends.list(userId);
  }

  /** 사용자 ID로 친구 요청 (상대의 요청이 이미 와 있으면 바로 친구) */
  @Post('requests')
  request(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(sendFriendRequestSchema)) body: SendFriendRequest,
  ): Promise<FriendChanged> {
    return this.friends.request(userId, body.username);
  }

  @Post('requests/:userId/accept')
  accept(
    @CurrentUserId() userId: string,
    @UuidParam('userId') otherId: string,
  ): Promise<FriendChanged> {
    return this.friends.accept(userId, otherId);
  }

  /** 받은 요청 거절, 보낸 요청 취소, 친구 끊기 */
  @Delete(':userId')
  remove(
    @CurrentUserId() userId: string,
    @UuidParam('userId') otherId: string,
  ): Promise<FriendChanged> {
    return this.friends.remove(userId, otherId);
  }
}
