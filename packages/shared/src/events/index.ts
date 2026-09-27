import { z } from 'zod';
import type { ChannelSummary, DmSummary } from '../api/channel.js';
import type { CommunityMember } from '../api/community.js';
import type { MessageDto, SendMessageRequest } from '../api/message.js';
import type {
  PlazaCorrection,
  PlazaMemberChange,
  PlazaMoveRequest,
  PlazaMoved,
  PlazaSnapshot,
} from '../plaza/events.js';
import type {
  VoiceCall,
  VoiceGains,
  VoiceJoinResult,
  VoiceJoined,
  VoiceLeft,
  VoiceMember,
  VoiceProximityChanged,
  VoiceSetProximityRequest,
  VoiceUpdateRequest,
} from '../voice/events.js';

/**
 * Socket.IO 이벤트 규칙: `도메인:동작`. 클라이언트 → 서버는 명령형, 서버 → 클라이언트는 과거형.
 * 방 이름: `user:<id>`, `community:<id>`, `channel:<id>`, `plaza:<id>`
 */
export const SocketEvent = {
  MessageSend: 'message:send',
  MessageCreated: 'message:created',
  TypingStart: 'typing:start',
  TypingStarted: 'typing:started',
  ChannelCreated: 'channel:created',
  DmCreated: 'dm:created',
  CommunityMemberJoined: 'community:member-joined',
  CommunityMemberLeft: 'community:member-left',
  CommunityDeleted: 'community:deleted',
  /** 역할, 채널 권한, 관리자가 바뀌었다: 커뮤니티 정보(볼 수 있는 채널 등)를 다시 받는다 */
  CommunityUpdated: 'community:updated',
  PresenceChanged: 'presence:changed',
  /** 광장 화면을 열 때: 광장 방에 들어가고 현재 상태(스냅숏)를 받는다 */
  PlazaWatch: 'plaza:watch',
  PlazaUnwatch: 'plaza:unwatch',
  PlazaMove: 'plaza:move',
  PlazaMoved: 'plaza:moved',
  PlazaMember: 'plaza:member',
  PlazaCorrected: 'plaza:corrected',
  /** 볼 수 있는 진행 중인 통화 전부 (접속할 때, 커뮤니티가 바뀔 때) */
  VoiceSync: 'voice:sync',
  VoiceJoin: 'voice:join',
  VoiceLeave: 'voice:leave',
  /** 내 마이크/헤드셋/말하는 중 상태 */
  VoiceUpdate: 'voice:update',
  VoiceSetProximity: 'voice:setProximity',
  VoiceJoined: 'voice:joined',
  VoiceLeft: 'voice:left',
  VoiceUpdated: 'voice:updated',
  VoiceProximityChanged: 'voice:proximityChanged',
  /** 근접 음성: 참여자별로 들려야 하는 음량 (받는 사람마다 다르다) */
  VoiceGains: 'voice:gains',
} as const;

export const typingStartSchema = z.object({ channelId: z.uuid() });

export type SocketAck<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ClientToServerEvents {
  [SocketEvent.MessageSend]: (
    payload: SendMessageRequest,
    ack: (result: SocketAck<MessageDto>) => void,
  ) => void;
  [SocketEvent.TypingStart]: (payload: { channelId: string }) => void;
  [SocketEvent.PlazaWatch]: (
    payload: { plazaId: string },
    ack: (result: SocketAck<PlazaSnapshot>) => void,
  ) => void;
  [SocketEvent.PlazaUnwatch]: (payload: { plazaId: string }) => void;
  [SocketEvent.PlazaMove]: (payload: PlazaMoveRequest) => void;
  [SocketEvent.VoiceSync]: (payload: object, ack: (result: SocketAck<VoiceCall[]>) => void) => void;
  [SocketEvent.VoiceJoin]: (
    payload: { channelId: string },
    ack: (result: SocketAck<VoiceJoinResult>) => void,
  ) => void;
  [SocketEvent.VoiceLeave]: (payload: object) => void;
  [SocketEvent.VoiceUpdate]: (payload: VoiceUpdateRequest) => void;
  [SocketEvent.VoiceSetProximity]: (
    payload: VoiceSetProximityRequest,
    ack: (result: SocketAck<null>) => void,
  ) => void;
}

export interface ServerToClientEvents {
  [SocketEvent.MessageCreated]: (message: MessageDto) => void;
  [SocketEvent.TypingStarted]: (payload: { channelId: string; userId: string }) => void;
  [SocketEvent.ChannelCreated]: (channel: ChannelSummary) => void;
  [SocketEvent.DmCreated]: (dm: DmSummary) => void;
  [SocketEvent.CommunityMemberJoined]: (payload: {
    communityId: string;
    member: CommunityMember;
  }) => void;
  [SocketEvent.CommunityMemberLeft]: (payload: { communityId: string; userId: string }) => void;
  [SocketEvent.CommunityDeleted]: (payload: { communityId: string }) => void;
  [SocketEvent.CommunityUpdated]: (payload: { communityId: string }) => void;
  [SocketEvent.PresenceChanged]: (payload: { userId: string; online: boolean }) => void;
  [SocketEvent.PlazaMoved]: (payload: PlazaMoved) => void;
  [SocketEvent.PlazaMember]: (payload: PlazaMemberChange) => void;
  [SocketEvent.PlazaCorrected]: (payload: PlazaCorrection) => void;
  [SocketEvent.VoiceJoined]: (payload: VoiceJoined) => void;
  [SocketEvent.VoiceLeft]: (payload: VoiceLeft) => void;
  [SocketEvent.VoiceUpdated]: (payload: { channelId: string; member: VoiceMember }) => void;
  [SocketEvent.VoiceProximityChanged]: (payload: VoiceProximityChanged) => void;
  [SocketEvent.VoiceGains]: (payload: VoiceGains) => void;
}

/** 입력 중 표시: 클라이언트는 이 간격마다 한 번만 typing:start를 보내고, 받은 쪽은 이 시간 동안 표시한다. */
export const TYPING_THROTTLE_MS = 3000;
export const TYPING_DISPLAY_MS = 5000;
