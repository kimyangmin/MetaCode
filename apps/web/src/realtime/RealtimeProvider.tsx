import {
  type ClientToServerEvents,
  type CommunitySummary,
  type DmSummary,
  type ServerToClientEvents,
  SocketEvent,
} from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { type Socket, io } from 'socket.io-client';
import { refreshWebSession } from '../api/client';
import { addMessageToCache, queryKeys } from '../api/queries';
import { API_URL } from '../config';
import { getDesktopBridge } from '../platform';
import { usePresenceStore } from '../stores/presence';
import { useTypingStore } from '../stores/typing';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

interface RealtimeContextValue {
  socket: AppSocket | null;
  status: RealtimeStatus;
}

const RealtimeContext = createContext<RealtimeContextValue>({ socket: null, status: 'connecting' });

export const useRealtime = () => useContext(RealtimeContext);

/**
 * 로그인한 동안 서버와 실시간 연결을 하나 유지하고, 서버 이벤트를 캐시에 반영한다.
 * 연결되어 있는 동안 서버는 이 사용자를 온라인으로 센다.
 */
export function RealtimeProvider({ meId, children }: { meId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [socket] = useState(createSocket);
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    const desktop = getDesktopBridge();

    let everConnected = false;
    let retriedAfterRefresh = false;
    socket.on('connect', () => {
      retriedAfterRefresh = false;
      setStatus('connected');
      // 끊겨 있던 동안 놓친 이벤트가 있을 수 있으니 다시 불러온다.
      if (everConnected) void queryClient.invalidateQueries();
      everConnected = true;
    });
    socket.on('disconnect', (reason) => {
      setStatus('disconnected');
      // 서버가 끊은 것은 인증 실패(토큰 만료)다. 웹은 세션을 갱신하고 한 번 더 시도한다.
      if (reason === 'io server disconnect' && !retriedAfterRefresh) {
        retriedAfterRefresh = true;
        void (desktop ? Promise.resolve(true) : refreshWebSession()).then((ok) => {
          if (ok) socket.connect();
        });
      }
    });
    socket.io.on('reconnect_attempt', () => setStatus('connecting'));

    socket.on(SocketEvent.MessageCreated, (message) => {
      addMessageToCache(queryClient, message);
      useTypingStore.getState().stop(message.channelId, message.author.id);
      // 목록에 없는 DM의 메시지면(다른 기기에서 막 만든 대화 등) 목록을 새로 받는다.
      const dms = queryClient.getQueryData<DmSummary[]>(queryKeys.dms);
      const communities = queryClient.getQueryData<CommunitySummary[]>(queryKeys.communities);
      const known =
        dms?.some((d) => d.id === message.channelId) ||
        communities?.some((c) => c.channels.some((ch) => ch.id === message.channelId));
      if (!known) void queryClient.invalidateQueries({ queryKey: queryKeys.dms });
    });
    socket.on(SocketEvent.TypingStarted, ({ channelId, userId }) => {
      if (userId !== meId) useTypingStore.getState().start(channelId, userId);
    });
    socket.on(SocketEvent.ChannelCreated, (channel) => {
      queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (communities) =>
        communities?.map((c) =>
          c.id === channel.communityId && !c.channels.some((ch) => ch.id === channel.id)
            ? { ...c, channels: [...c.channels, channel] }
            : c,
        ),
      );
    });
    socket.on(SocketEvent.DmCreated, (dm) => {
      queryClient.setQueryData<DmSummary[]>(queryKeys.dms, (dms) =>
        dms && !dms.some((d) => d.id === dm.id) ? [dm, ...dms] : dms,
      );
    });
    socket.on(SocketEvent.CommunityMemberJoined, ({ communityId, member }) => {
      usePresenceStore.getState().set(member.user.id, member.online);
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(communityId) });
    });
    const removeCommunity = (communityId: string) =>
      queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (communities) =>
        communities?.filter((c) => c.id !== communityId),
      );
    socket.on(SocketEvent.CommunityMemberLeft, ({ communityId, userId }) => {
      if (userId === meId) removeCommunity(communityId);
      else void queryClient.invalidateQueries({ queryKey: queryKeys.members(communityId) });
    });
    socket.on(SocketEvent.CommunityDeleted, ({ communityId }) => removeCommunity(communityId));
    socket.on(SocketEvent.PresenceChanged, ({ userId, online }) => {
      usePresenceStore.getState().set(userId, online);
    });

    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.io.removeAllListeners('reconnect_attempt');
      socket.disconnect();
    };
  }, [meId, queryClient, socket]);

  return <RealtimeContext.Provider value={{ socket, status }}>{children}</RealtimeContext.Provider>;
}

/** 연결은 RealtimeProvider의 effect에서 시작한다. */
function createSocket(): AppSocket {
  const desktop = getDesktopBridge();
  return io(API_URL, {
    autoConnect: false,
    transports: ['websocket'],
    withCredentials: true,
    // 연결(재연결)할 때마다 새 토큰을 받는다.
    auth: desktop
      ? (cb) => {
          void desktop.auth.getAccessToken().then((token) => cb({ token }));
        }
      : undefined,
  });
}
