import { Param } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

/** 경로의 UUID(v7 포함)를 검증한다. Nest 기본 ParseUUIDPipe는 v7을 모를 수 있어 zod를 쓴다. */
export const UuidParam = (name: string) => Param(name, new ZodValidationPipe(z.uuid()));
