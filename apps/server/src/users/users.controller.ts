import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { UserProfile } from '@metacode/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { z } from 'zod';
import { CurrentUserId } from '../auth/current-user.decorator.js';
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
  me(@CurrentUserId() userId: string): Promise<UserProfile> {
    return this.users.getProfile(userId);
  }
}
