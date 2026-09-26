import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { type CreateDmRequest, type DmSummary, createDmSchema } from '@metacode/shared';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DmsService } from './dms.service.js';

@Controller('dms')
@UseGuards(AuthGuard)
export class DmsController {
  constructor(private readonly dms: DmsService) {}

  @Get()
  list(@CurrentUserId() userId: string): Promise<DmSummary[]> {
    return this.dms.list(userId);
  }

  /** 새로 만들었으면 201, 이미 있던 1:1 DM이면 200 */
  @Post()
  async open(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createDmSchema)) body: CreateDmRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DmSummary> {
    const { dm, created } = await this.dms.open(userId, body.userIds);
    res.status(created ? 201 : 200);
    return dm;
  }
}
