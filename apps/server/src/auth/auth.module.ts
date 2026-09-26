import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { GithubClient } from './github.client.js';
import { OAuthStore } from './oauth.store.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [GithubClient, OAuthStore, SessionService],
})
export class AuthModule {}
