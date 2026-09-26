import { z } from 'zod';
import type { ChannelSummary, DmSummary } from '../api/channel.js';
import type { CommunityMember } from '../api/community.js';
import type { MessageDto, SendMessageRequest } from '../api/message.js';

/**
 * Socket.IO 이벤트 규칙: `도메인:동작`. 클라이언트 → 서버는 명령형, 서버 → 클라이언트는 과거형.
 * 방 이름: `user:<id>`, `community:<id>`, `channel:<id>`
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
  PresenceChanged: 'presence:changed',
} as const;

export const typingStartSchema = z.object({ channelId: z.uuid() });

export type SocketAck<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ClientToServerEvents {
  [SocketEvent.MessageSend]: (
    payload: SendMessageRequest,
    ack: (result: SocketAck<MessageDto>) => void,
  ) => void;
  [SocketEvent.TypingStart]: (payload: { channelId: string }) => void;
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
  [SocketEvent.PresenceChanged]: (payload: { userId: string; online: boolean }) => void;
}

/** 입력 중 표시: 클라이언트는 이 간격마다 한 번만 typing:start를 보내고, 받은 쪽은 이 시간 동안 표시한다. */
export const TYPING_THROTTLE_MS = 3000;
export const TYPING_DISPLAY_MS = 5000;
