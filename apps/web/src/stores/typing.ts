import { TYPING_DISPLAY_MS } from '@metacode/shared';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

interface TypingState {
  /** channelId → 입력 중인 userId 목록 */
  typing: Record<string, string[]>;
  start(channelId: string, userId: string): void;
  stop(channelId: string, userId: string): void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** 입력 중 표시. 신호를 받은 뒤 일정 시간이 지나거나 그 사람의 메시지가 오면 지운다. */
export const useTypingStore = create<TypingState>((set, get) => ({
  typing: {},
  start(channelId, userId) {
    const key = `${channelId}:${userId}`;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => get().stop(channelId, userId), TYPING_DISPLAY_MS),
    );
    set((s) => {
      const current = s.typing[channelId] ?? [];
      if (current.includes(userId)) return s;
      return { typing: { ...s.typing, [channelId]: [...current, userId] } };
    });
  },
  stop(channelId, userId) {
    const key = `${channelId}:${userId}`;
    clearTimeout(timers.get(key));
    timers.delete(key);
    set((s) => {
      const current = s.typing[channelId];
      if (!current?.includes(userId)) return s;
      return { typing: { ...s.typing, [channelId]: current.filter((id) => id !== userId) } };
    });
  },
}));

export const useTypingUsers = (channelId: string) =>
  useTypingStore(useShallow((s) => s.typing[channelId] ?? []));
