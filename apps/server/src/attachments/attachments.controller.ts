import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AttachmentDto,
  type AttachmentQuery,
  type CreateUploadRequest,
  type UploadTicket,
  attachmentQuerySchema,
  createUploadSchema,
} from '@metacode/shared';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { UuidParam } from '../common/params.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AttachmentsService } from './attachments.service.js';

@Controller()
@UseGuards(AuthGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('uploads')
  createUpload(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(createUploadSchema)) body: CreateUploadRequest,
  ): Promise<UploadTicket> {
    return this.attachments.createUpload(userId, body);
  }

  @Post('uploads/:id/complete')
  @HttpCode(200)
  complete(@CurrentUserId() userId: string, @UuidParam('id') id: string): Promise<AttachmentDto> {
    return this.attachments.complete(userId, id);
  }

  @Delete('uploads/:id')
  @HttpCode(204)
  cancel(@CurrentUserId() userId: string, @UuidParam('id') id: string): Promise<void> {
    return this.attachments.cancel(userId, id);
  }

  /**
   * 첨부 보기/받기. 권한을 확인하고 짧게 유효한 저장소 주소로 보낸다(302).
   * 웹은 쿠키, 데스크톱은 메인 프로세스가 붙여 주는 Authorization 헤더로 인증한다
   * (<img>는 헤더를 직접 붙일 수 없으므로).
   */
  @Get('attachments/:id')
  async open(
    @CurrentUserId() userId: string,
    @UuidParam('id') id: string,
    @Query(new ZodValidationPipe(attachmentQuerySchema)) query: AttachmentQuery,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.attachments.downloadUrl(userId, id, query);
    // 이 응답(권한 확인 결과)은 저장하지 않는다. 브라우저 캐시는 사용자(쿠키)를 구분하지 않아서,
    // 캐시하면 로그아웃한 뒤나 다른 계정에서도 같은 주소로 저장소에 갈 수 있다.
    res.set('Cache-Control', 'no-store');
    res.redirect(302, url);
  }
}
