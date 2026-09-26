import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 모노레포 루트의 .env를 우선 읽는다.
      envFilePath: ['../../.env', '.env'],
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
