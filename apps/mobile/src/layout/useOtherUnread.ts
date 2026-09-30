import { hasUnread } from '@metacode/shared';
import { useCommunities, useDms } from '../api/queries';

/** 지금 보는 채널 밖에 안 읽은 메시지가 있는지 (머리글 ☰의 점) */
export function useOtherUnread(currentChannelId: string | null): boolean {
  const communities = useCommunities().data ?? [];
  const dms = useDms().data ?? [];
  const other = (ch: {
    id: string;
    lastMessageId: string | null;
    lastReadMessageId: string | null;
  }) => ch.id !== currentChannelId && hasUnread(ch);
  return (
    dms.some(other) ||
    communities.some((c) => c.channels.some((ch) => ch.type === 'TEXT' && other(ch)))
  );
}
