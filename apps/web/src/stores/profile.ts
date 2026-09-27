import type { UserProfile } from '@metacode/shared';
import { create } from 'zustand';

export interface ProfileTarget {
  user: UserProfile;
  /** 누른 위치 (팝업을 그 옆에 띄운다) */
  x: number;
  y: number;
  /** 커뮤니티 화면에서 열었으면 그 커뮤니티의 역할을 함께 보여 준다 */
  communityId?: string;
}

interface ProfileState {
  target: ProfileTarget | null;
  open(target: ProfileTarget): void;
  close(): void;
}

/** 사용자 정보 팝업 (아바타나 이름을 누르면 뜬다). 화면에 하나만 */
export const useProfileStore = create<ProfileState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

/** 아바타·이름 버튼의 onClick에 넣는다 */
export const openProfile = (
  user: UserProfile,
  event: { clientX: number; clientY: number },
  communityId?: string,
) => useProfileStore.getState().open({ user, x: event.clientX, y: event.clientY, communityId });
