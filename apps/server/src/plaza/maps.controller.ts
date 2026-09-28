import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { type CommunityMapDto, type SaveMapRequest, saveMapSchema } from '@metacode/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { UuidParam } from '../common/params.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PlazaMapsService } from './plaza-maps.service.js';

/** 커뮤니티 분수 광장의 맵 (맵 에디터) */
@Controller('communities/:id/map')
@UseGuards(AuthGuard)
export class MapsController {
  constructor(private readonly maps: PlazaMapsService) {}

  @Get()
  get(@CurrentUserId() userId: string, @UuidParam('id') id: string): Promise<CommunityMapDto> {
    return this.maps.get(userId, id);
  }

  @Put()
  save(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Body(new ZodValidationPipe(saveMapSchema)) body: SaveMapRequest,
  ): Promise<CommunityMapDto> {
    return this.maps.save(userId, id, body.definition);
  }

  /** 내장 분수 광장으로 되돌리기 */
  @Delete()
  reset(@CurrentUserId() userId: string, @UuidParam('id') id: string): Promise<CommunityMapDto> {
    return this.maps.reset(userId, id);
  }
}
