import { create } from 'zustand';

interface PresenceState {
  online: Record<string, boolean>;
  set(userId: string, online: boolean): void;
  merge(entries: Record<string, boolean>): void;
}

/** 사용자별 온라인 여부. 멤버 목록 조회로 채우고 presence:changed 이벤트로 갱신한다. */
export const usePresenceStore = create<PresenceState>((set) => ({
  online: {},
  set: (userId, online) => set((s) => ({ online: { ...s.online, [userId]: online } })),
  merge: (entries) => set((s) => ({ online: { ...s.online, ...entries } })),
}));

export const useIsOnline = (userId: string) => usePresenceStore((s) => s.online[userId] ?? false);
