import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UserProfile } from '@metacode/shared';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import type { Env } from '../config/env.js';

/** 채널 하나 = LiveKit 방 하나 */
export const livekitRoom = (channelId: string) => `channel-${channelId}`;

/**
 * 음성 서버(LiveKit, 셀프 호스팅) 연동. 입장권(JWT)을 만들고, 통화에서 뺄 사람을 끊는다.
 * 설정이 비어 있으면 음성 통화를 쓸 수 없고, 나머지 기능은 그대로 동작한다.
 */
@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly rooms: RoomServiceClient | null;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  /** 브라우저가 접속하는 주소 */
  readonly publicUrl: string;

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('LIVEKIT_URL', { infer: true });
    this.apiKey = config.get('LIVEKIT_API_KEY');
    this.apiSecret = config.get('LIVEKIT_API_SECRET');
    this.rooms =
      url && this.apiKey && this.apiSecret
        ? new RoomServiceClient(url, this.apiKey, this.apiSecret)
        : null;
    this.publicUrl = config.get('LIVEKIT_PUBLIC_URL', { infer: true }) ?? url ?? '';
  }

  get enabled(): boolean {
    return this.rooms !== null;
  }

  /**
   * 이 채널의 통화 입장권. 신원은 사용자 ID라서, 같은 사람이 다른 탭이나 기기로 들어오면
   * LiveKit이 앞의 연결을 끊는다 (한 사람은 통화 하나에 한 연결). 마이크와 화면 공유(영상, 소리)만 올릴 수 있다.
   */
  token(channelId: string, user: UserProfile): Promise<string> {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: user.id,
      name: user.displayName ?? user.username,
      ttl: '1h',
    });
    token.addGrant({
      roomJoin: true,
      room: livekitRoom(channelId),
      canPublish: true,
      canPublishSources: [
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ],
      canSubscribe: true,
      canPublishData: false,
    });
    return token.toJwt();
  }

  /** 통화에서 뺀다 (다른 통화로 옮김, 연결 끊김, 커뮤니티 탈퇴). 이미 나가 있으면 무시한다 */
  async disconnect(channelId: string, userId: string): Promise<void> {
    if (!this.rooms) return;
    try {
      await this.rooms.removeParticipant(livekitRoom(channelId), userId);
    } catch (error) {
      // 이미 방에 없으면 not_found. 음성 서버가 잠깐 안 될 때도 통화 목록 처리는 계속한다.
      this.logger.debug(`참여자 끊기 실패 (${channelId}, ${userId}): ${String(error)}`);
    }
  }
}
