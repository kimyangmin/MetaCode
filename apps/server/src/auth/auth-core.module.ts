import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthGuard } from './auth.guard.js';

/** 어느 모듈에서든 AuthGuard를 쓸 수 있도록 토큰 검증만 전역으로 제공한다. */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  providers: [AccessTokenService, AuthGuard],
  exports: [AccessTokenService, AuthGuard],
})
export class AuthCoreModule {}
