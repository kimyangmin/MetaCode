import type { UserProfile } from '@metacode/shared';
import { create } from 'zustand';

export interface ProfileTarget {
  user: UserProfile;
  /** 누른 위치 (팝업을 그 옆에 띄운다) */
  x: number;
  y: number;
  /** 커뮤니티 화면에서 열었으면 그 커뮤니티의 역할을 함께 보여 준다 */
  communityId?: string;
  /** 팝업을 연 요소 (같은 요소를 다시 누르면 닫는다) */
  anchor?: Element;
  /**
   * 누른 위치 대신 이 요소의 왼쪽 바깥에, 연 요소(anchor)와 같은 높이로 띄운다 (멤버 목록).
   * 휴대폰에서는 아래에서 올라오는 시트로, 그 밖에 왼쪽에 자리가 없으면 누른 위치 옆에 띄운다.
   */
  beside?: Element;
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

/**
 * 아바타·이름 버튼의 onClick에 넣는다. 같은 사람의 팝업을 연 요소를 다시 누르면 닫는다.
 */
export function openProfile(
  user: UserProfile,
  event: { clientX: number; clientY: number; currentTarget?: EventTarget | null },
  communityId?: string,
  beside?: Element | null,
): void {
  const store = useProfileStore.getState();
  const anchor = event.currentTarget instanceof Element ? event.currentTarget : undefined;
  if (anchor && store.target?.anchor === anchor && store.target.user.id === user.id) {
    store.close();
    return;
  }
  store.open({
    user,
    x: event.clientX,
    y: event.clientY,
    communityId,
    anchor,
    beside: beside ?? undefined,
  });
}
