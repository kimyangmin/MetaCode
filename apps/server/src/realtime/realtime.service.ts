import { Injectable } from '@nestjs/common';
import type { ClientToServerEvents, ServerToClientEvents } from '@metacode/shared';
import type { Server } from 'socket.io';

export interface SocketData {
  userId?: string;
}

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

export const room = {
  user: (id: string) => `user:${id}`,
  community: (id: string) => `community:${id}`,
  channel: (id: string) => `channel:${id}`,
  /** 광장 화면을 열어 둔 연결만 들어간다 (위치 업데이트 구독). plazaId는 community:<id> 또는 dm:<id> */
  plaza: (plazaId: string) => `plaza:${plazaId}`,
};

type Emit = ServerToClientEvents;

/**
 * HTTP 요청을 처리하는 서비스가 실시간 이벤트를 보내고 방(room) 구성을 바꿀 때 쓴다.
 * Socket.IO 서버는 게이트웨이가 초기화될 때 넘겨준다.
 */
@Injectable()
export class RealtimeService {
  private server: AppServer | null = null;

  attach(server: AppServer): void {
    this.server = server;
  }

  emit<E extends keyof Emit>(rooms: string | string[], event: E, ...args: Parameters<Emit[E]>) {
    // 게이트웨이가 뜨기 전(테스트의 일부 경우)에는 보낼 곳이 없다.
    this.server?.to(rooms).emit(event, ...args);
  }

  /** 이 사용자의 모든 연결(탭, 기기)을 방에 넣는다. */
  joinUser(userId: string, rooms: string[]): void {
    if (rooms.length > 0) this.server?.in(room.user(userId)).socketsJoin(rooms);
  }

  leaveUser(userId: string, rooms: string[]): void {
    if (rooms.length > 0) this.server?.in(room.user(userId)).socketsLeave(rooms);
  }

  /** 어떤 방에 있는 모든 연결을 다른 방에도 넣는다 (예: 커뮤니티 멤버 전원을 새 채널 방에). */
  joinRoom(from: string, rooms: string[]): void {
    this.server?.in(from).socketsJoin(rooms);
  }

  clearRoom(target: string): void {
    this.server?.in(target).socketsLeave(target);
  }
}
