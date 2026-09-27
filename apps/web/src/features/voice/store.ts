import type { VoiceCall } from '@metacode/shared';
import { create } from 'zustand';
import { type Calls, callsFromList, withMember, withProximity, withoutMember } from './calls';

export interface VoiceSession {
  channelId: string;
  status: 'connecting' | 'connected' | 'reconnecting';
  /** 마이크를 찾지 못했거나 권한이 없어 듣기만 하는 중 */
  listenOnly: boolean;
}

interface VoiceState {
  /** 볼 수 있는 진행 중인 통화 전부 (채팅 모드 목록, 광장 표시) */
  calls: Calls;
  /** 내가 들어가 있는 통화 */
  session: VoiceSession | null;
  muted: boolean;
  deafened: boolean;
  /** 근접 음성: 참여자별 음량 (지금 통화) */
  gains: Record<string, number>;
  /** 마지막 오류 (통화에 못 들어감 등). 음성 패널에 보여 준다 */
  error: string | null;
  /** 브라우저가 소리 재생을 막았다 (사용자가 한 번 눌러야 들린다) */
  playbackBlocked: boolean;
  /** 내 화면을 공유하는 중 */
  sharing: boolean;
  /** 보고 있는 화면 공유 (사용자 ID). 없으면 보는 창이 닫혀 있다 */
  watching: string | null;
  /** 보고 있는 화면 공유의 영상. 받기 전이거나 공유가 끝났으면 null */
  screen: MediaStream | null;
  inputDeviceId: string | null;
  outputDeviceId: string | null;

  setCalls(list: VoiceCall[]): void;
  upsertMember(channelId: string, member: VoiceCall['members'][number]): void;
  removeMember(channelId: string, userId: string): void;
  setProximity(channelId: string, enabled: boolean): void;
  setSession(session: VoiceSession | null): void;
  patch(
    values: Partial<
      Pick<
        VoiceState,
        | 'muted'
        | 'deafened'
        | 'gains'
        | 'error'
        | 'playbackBlocked'
        | 'sharing'
        | 'watching'
        | 'screen'
      >
    >,
  ): void;
  setDevice(kind: 'audioinput' | 'audiooutput', deviceId: string): void;
}

const DEVICE_KEYS = {
  audioinput: 'metacode:voice-input',
  audiooutput: 'metacode:voice-output',
} as const;

function readDevice(kind: keyof typeof DEVICE_KEYS): string | null {
  try {
    return localStorage.getItem(DEVICE_KEYS[kind]);
  } catch {
    return null;
  }
}

export const useVoiceStore = create<VoiceState>((set) => ({
  calls: {},
  session: null,
  muted: false,
  deafened: false,
  gains: {},
  error: null,
  playbackBlocked: false,
  sharing: false,
  watching: null,
  screen: null,
  inputDeviceId: readDevice('audioinput'),
  outputDeviceId: readDevice('audiooutput'),

  setCalls: (list) => set({ calls: callsFromList(list) }),
  upsertMember: (channelId, member) =>
    set((s) => ({ calls: withMember(s.calls, channelId, member) })),
  removeMember: (channelId, userId) =>
    set((s) => ({ calls: withoutMember(s.calls, channelId, userId) })),
  setProximity: (channelId, enabled) =>
    set((s) => ({ calls: withProximity(s.calls, channelId, enabled) })),
  setSession: (session) => set({ session }),
  patch: (values) => set(values),
  setDevice: (kind, deviceId) => {
    try {
      localStorage.setItem(DEVICE_KEYS[kind], deviceId);
    } catch {
      // 기억하지 못해도 이번 실행에서는 적용된다.
    }
    set(kind === 'audioinput' ? { inputDeviceId: deviceId } : { outputDeviceId: deviceId });
  },
}));

/** 이 채널의 통화 (없으면 undefined) */
export const useCall = (channelId: string) => useVoiceStore((s) => s.calls[channelId]);
