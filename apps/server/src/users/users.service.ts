import { Injectable, NotFoundException } from '@nestjs/common';
import type { UserProfile } from '@metacode/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** GitHub 로그인마다 닉네임, 이름, 아바타를 GitHub 계정 기준으로 맞춘다. */
  async upsertFromGithub(github: GithubProfile): Promise<UserProfile> {
    const profile = {
      username: github.login,
      displayName: github.name,
      avatarUrl: github.avatarUrl,
    };
    const user = await this.prisma.user.upsert({
      where: { githubId: BigInt(github.id) },
      create: { githubId: BigInt(github.id), ...profile },
      update: profile,
    });
    return toProfile(user);
  }

  /** DM 상대 찾기: GitHub 아이디 앞부분으로 검색한다 (나는 제외, 최대 10명). */
  async search(userId: string, query: string): Promise<UserProfile[]> {
    const users = await this.prisma.user.findMany({
      where: { id: { not: userId }, username: { startsWith: query, mode: 'insensitive' } },
      orderBy: { username: 'asc' },
      take: 10,
    });
    return users.map(toProfile);
  }

  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    return toProfile(user);
  }
}

export function toProfile(user: {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string;
}): UserProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}
