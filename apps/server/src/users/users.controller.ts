import { Controller, Get, UseGuards } from '@nestjs/common';
import type { UserProfile } from '@metacode/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUserId() userId: string): Promise<UserProfile> {
    return this.users.getProfile(userId);
  }
}
