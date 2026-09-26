import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { refreshWebSession } from '../../api/client';
import { API_URL } from '../../config';
import { getDesktopBridge } from '../../platform';

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * 서버와의 실시간 연결. 연결되어 있는 동안 서버가 이 사용자를 온라인으로 센다.
 * 웹은 쿠키, 데스크톱은 auth.token으로 인증한다.
 */
export function useRealtimeConnection(enabled: boolean): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    if (!enabled) return;
    const desktop = getDesktopBridge();

    const socket = io(API_URL, {
      transports: ['websocket'],
      withCredentials: true,
      // 연결(재연결)할 때마다 새 토큰을 받는다.
      auth: desktop
        ? (cb) => {
            void desktop.auth.getAccessToken().then((token) => cb({ token }));
          }
        : undefined,
    });

    let retriedAfterRefresh = false;
    socket.on('connect', () => {
      retriedAfterRefresh = false;
      setStatus('connected');
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

    return () => {
      socket.disconnect();
    };
  }, [enabled]);

  return enabled ? status : 'disconnected';
}
