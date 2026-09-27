import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { useRealtime } from '../../realtime/RealtimeProvider';
import { useCommunities } from '../communities/hooks';
import { VoiceController } from './controller';

const VoiceContext = createContext<VoiceController | null>(null);

export function useVoice(): VoiceController {
  const controller = useContext(VoiceContext);
  if (!controller) throw new Error('VoiceProvider 안에서만 쓸 수 있습니다.');
  return controller;
}

/**
 * 음성 통화. 화면을 옮겨도 통화가 끊기지 않도록 라우터 바깥에 둔다.
 * 상태는 useVoiceStore에서 읽고, 동작(들어가기, 음소거 등)은 useVoice()로 한다.
 */
export function VoiceProvider({ meId, children }: { meId: string; children: ReactNode }) {
  const { socket } = useRealtime();
  const communities = useCommunities();
  const [controller] = useState(() => new VoiceController(meId));

  useEffect(() => (socket ? controller.attach(socket) : undefined), [controller, socket]);

  // 커뮤니티에 들어가거나 나가면 볼 수 있는 통화가 바뀐다.
  const communityIds = communities.data?.map((c) => c.id).join(',');
  useEffect(() => {
    if (communityIds !== undefined) void controller.resync();
  }, [communityIds, controller]);

  useEffect(() => () => controller.dispose(), [controller]);

  return <VoiceContext.Provider value={controller}>{children}</VoiceContext.Provider>;
}
