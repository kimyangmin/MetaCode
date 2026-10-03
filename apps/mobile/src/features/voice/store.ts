import {
  type Calls,
  callsFromList,
  withMember,
  withProximity,
  withoutMember,
} from '@metacode/client';
import type { VoiceCall } from '@metacode/shared';
import { create } from 'zustand';

export interface VoiceSession {
  channelId: string;
  status: 'connecting' | 'connected' | 'reconnecting';
  /** 마이크 권한이 없어 듣기만 하는 중 */
  listenOnly: boolean;
}

/** 보고 있는 화면 공유 (웹 store의 watching/screen/watchChannel/watchError/watchJoining) */
export interface Watching {
  channelId: string;
  userId: string;
  /** 받고 있는 영상의 RTCView 주소 (받기 전이면 null) */
  streamUrl: string | null;
  /** 보려고 통화에 들어가는 중 */
  joining: boolean;
  /** 들어가지 못했을 때의 사유 */
  error: string | null;
  /** 보려고 들어가면서 마이크를 꺼 두었다 */
  mutedOnJoin: boolean;
}

interface VoiceState {
  /** 볼 수 있는 진행 중인 통화 전부 (채널 목록, 광장 표시) */
  calls: Calls;
  /** 내가 들어가 있는 통화 */
  session: VoiceSession | null;
  muted: boolean;
  deafened: boolean;
  /** 근접 음성: 참여자별 음량 (지금 통화) */
  gains: Record<string, number>;
  /** 마지막 오류 (통화에 못 들어감 등). 음성 패널에 보여 준다 */
  error: string | null;
  watching: Watching | null;

  setCalls(list: VoiceCall[]): void;
  upsertMember(channelId: string, member: VoiceCall['members'][number]): void;
  removeMember(channelId: string, userId: string): void;
  setProximity(channelId: string, enabled: boolean): void;
  setSession(session: VoiceSession | null): void;
  patch(
    values: Partial<Pick<VoiceState, 'muted' | 'deafened' | 'gains' | 'error' | 'watching'>>,
  ): void;
}

/**
 * 음성 통화 상태 (웹 features/voice/store.ts의 휴대폰판). 장치 고르기·마이크 증폭·입력 감도는 아직 없고
 * (안드로이드 기본 잡음 억제·에코 제거를 씀), 화면 공유는 보기만 한다.
 */
export const useVoiceStore = create<VoiceState>((set) => ({
  calls: {},
  session: null,
  muted: false,
  deafened: false,
  gains: {},
  error: null,
  watching: null,

  setCalls: (list) => set({ calls: callsFromList(list) }),
  upsertMember: (channelId, member) =>
    set((s) => ({ calls: withMember(s.calls, channelId, member) })),
  removeMember: (channelId, userId) =>
    set((s) => ({ calls: withoutMember(s.calls, channelId, userId) })),
  setProximity: (channelId, enabled) =>
    set((s) => ({ calls: withProximity(s.calls, channelId, enabled) })),
  setSession: (session) => set({ session }),
  patch: (values) => set(values),
}));

/** 이 채널의 통화 (없으면 undefined) */
export const useCall = (channelId: string) => useVoiceStore((s) => s.calls[channelId]);
