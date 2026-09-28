import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AssetDto,
  createAssetSchema,
  listAssetsQuerySchema,
  updateAssetSchema,
} from '@metacode/shared';
import type { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { UuidParam } from '../common/params.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AssetsService } from './assets.service.js';

@Controller('assets')
@UseGuards(AuthGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  /** communityId가 있으면 그 커뮤니티의 타일·오브젝트, 없으면 내 캐릭터 */
  @Get()
  list(
    @CurrentUserId() userId: string,
    @Query(new ZodValidationPipe(listAssetsQuerySchema))
    query: z.output<typeof listAssetsQuerySchema>,
  ): Promise<AssetDto[]> {
    return query.communityId
      ? this.assets.listCommunity(userId, query.communityId)
      : this.assets.listMine(userId);
  }

  @Get(':id')
  get(@CurrentUserId() userId: string, @UuidParam('id') id: string): Promise<AssetDto> {
    return this.assets.get(userId, id);
  }

  @Post()
  create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createAssetSchema)) body: z.output<typeof createAssetSchema>,
  ): Promise<AssetDto> {
    return this.assets.create(userId, body.communityId, body.manifest);
  }

  @Put(':id')
  update(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Body(new ZodValidationPipe(updateAssetSchema)) body: z.output<typeof updateAssetSchema>,
  ): Promise<AssetDto> {
    return this.assets.update(userId, id, body.manifest);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUserId() userId: string, @UuidParam('id') id: string): Promise<void> {
    return this.assets.remove(userId, id);
  }
}
