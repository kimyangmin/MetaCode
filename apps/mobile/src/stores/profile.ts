import type { UserProfile } from '@metacode/shared';
import { create } from 'zustand';

export interface ProfileTarget {
  user: UserProfile;
  /** 커뮤니티 화면에서 열었으면 그 커뮤니티의 역할을 함께 보여 준다 */
  communityId?: string;
}

interface ProfileState {
  target: ProfileTarget | null;
  close(): void;
}

/** 사용자 정보 시트 (웹 stores/profile.ts의 휴대폰판: 아래에서 올라오는 시트). 화면에 하나만 */
export const useProfileStore = create<ProfileState>((set) => ({
  target: null,
  close: () => set({ target: null }),
}));

/** 아바타·이름을 누르면 그 사람의 정보 시트를 연다 */
export function openProfile(user: UserProfile, communityId?: string): void {
  useProfileStore.setState({ target: { user, communityId } });
}
