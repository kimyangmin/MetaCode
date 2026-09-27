import { z } from 'zod';
import type { UserProfile } from '../api/user.js';

/** 음성 채널이나 DM의 통화에 들어간다 */
export const voiceJoinSchema = z.object({ channelId: z.uuid() });

/** 내 통화 상태 (마이크 음소거, 헤드셋 끄기, 말하는 중, 화면 공유 중). 지금 들어가 있는 통화에 적용된다 */
export const voiceUpdateSchema = z.object({
  muted: z.boolean(),
  deafened: z.boolean(),
  speaking: z.boolean(),
  // 화면 공유가 없던 클라이언트(이전 버전)는 보내지 않는다.
  sharing: z.boolean().default(false),
});

/** 클라이언트가 보내는 형태 (sharing은 빠질 수 있음) */
export type VoiceUpdateRequest = z.input<typeof voiceUpdateSchema>;
/** 서버가 검증한 뒤의 형태 */
export type VoiceUpdateState = z.infer<typeof voiceUpdateSchema>;

/** 근접 음성 켜기/끄기. 그 통화의 참여자 누구나 바꿀 수 있다 */
export const voiceSetProximitySchema = z.object({
  channelId: z.uuid(),
  enabled: z.boolean(),
});

export type VoiceSetProximityRequest = z.infer<typeof voiceSetProximitySchema>;

/** 통화 참여자 한 명 */
export interface VoiceMember {
  user: UserProfile;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  /** 화면을 공유하는 중. 같은 통화 참여자가 눌러서 볼 수 있다 */
  sharing: boolean;
}

/** 진행 중인 통화 하나 (참여자가 있는 음성 채널 또는 DM) */
export interface VoiceCall {
  channelId: string;
  /** 근접 음성. 켜져 있으면 광장에서 가까운 참여자끼리만 들린다 */
  proximity: boolean;
  members: VoiceMember[];
}

/** 통화에 들어갈 때 받는 것: 음성 서버 주소와 입장권, 지금 통화 상태 */
export interface VoiceJoinResult {
  url: string;
  token: string;
  call: VoiceCall;
}

export interface VoiceJoined {
  channelId: string;
  member: VoiceMember;
}

export interface VoiceLeft {
  channelId: string;
  userId: string;
}

export interface VoiceProximityChanged {
  channelId: string;
  enabled: boolean;
}

/**
 * 근접 음성이 켜진 통화에서, 받는 사람에게 다른 참여자들이 얼마나 크게 들려야 하는지 (0~1).
 * 0이면 들리지 않으므로 구독하지 않는다. 목록에 없는 참여자도 0이다.
 */
export interface VoiceGains {
  channelId: string;
  gains: Record<string, number>;
}
