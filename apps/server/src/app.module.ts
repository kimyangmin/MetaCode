import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthCoreModule } from './auth/auth-core.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ChatModule } from './chat/chat.module.js';
import { FriendsModule } from './friends/friends.module.js';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { PresenceModule } from './presence/presence.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RedisModule } from './redis/redis.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 모노레포 루트의 .env를 우선 읽는다. 이미 설정된 환경변수가 우선이다.
      envFilePath: ['../../.env', '.env'],
      // 테스트는 test/env.ts의 값만 쓴다.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnv,
    }),
    PrismaModule,
    RedisModule,
    RealtimeModule,
    StorageModule,
    AuthCoreModule,
    AuthModule,
    UsersModule,
    PresenceModule,
    FriendsModule,
    ChatModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
