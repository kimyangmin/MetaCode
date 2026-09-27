import { Body, Controller, Delete, HttpCode, Patch, Post, Put, UseGuards } from '@nestjs/common';
import {
  type ChannelSummary,
  type RoleDto,
  createRoleSchema,
  setAdminSchema,
  setMemberRolesSchema,
  updateChannelSchema,
  updateRoleSchema,
} from '@metacode/shared';
import type { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { UuidParam } from '../common/params.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RolesService } from './roles.service.js';

/** 역할, 멤버의 역할과 관리자 여부, 채널 권한 (소유자와 관리자) */
@Controller()
@UseGuards(AuthGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Post('communities/:id/roles')
  createRole(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Body(new ZodValidationPipe(createRoleSchema)) body: z.infer<typeof createRoleSchema>,
  ): Promise<RoleDto> {
    return this.roles.createRole(userId, id, body);
  }

  @Patch('communities/:id/roles/:roleId')
  updateRole(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @UuidParam('roleId') roleId: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: z.infer<typeof updateRoleSchema>,
  ): Promise<RoleDto> {
    return this.roles.updateRole(userId, id, roleId, body);
  }

  @Delete('communities/:id/roles/:roleId')
  @HttpCode(204)
  deleteRole(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @UuidParam('roleId') roleId: string,
  ): Promise<void> {
    return this.roles.deleteRole(userId, id, roleId);
  }

  @Put('communities/:id/members/:userId/roles')
  @HttpCode(204)
  setMemberRoles(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @UuidParam('userId') targetId: string,
    @Body(new ZodValidationPipe(setMemberRolesSchema)) body: z.infer<typeof setMemberRolesSchema>,
  ): Promise<void> {
    return this.roles.setMemberRoles(userId, id, targetId, body.roleIds);
  }

  @Put('communities/:id/members/:userId/admin')
  @HttpCode(204)
  setAdmin(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @UuidParam('userId') targetId: string,
    @Body(new ZodValidationPipe(setAdminSchema)) body: z.infer<typeof setAdminSchema>,
  ): Promise<void> {
    return this.roles.setAdmin(userId, id, targetId, body.admin);
  }

  @Patch('channels/:id')
  updateChannel(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Body(new ZodValidationPipe(updateChannelSchema)) body: z.infer<typeof updateChannelSchema>,
  ): Promise<ChannelSummary> {
    return this.roles.updateChannel(userId, id, body);
  }
}
