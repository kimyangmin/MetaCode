import { create } from 'zustand';

const MEMBERS_HIDDEN_KEY = 'metacode:members-hidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(MEMBERS_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

interface UiState {
  /** 커뮤니티 화면 오른쪽 멤버 목록을 숨겼는지 (기억한다) */
  membersHidden: boolean;
  toggleMembers(): void;
  /** 좁은 화면: 멤버 목록 서랍을 열었는지 (기억하지 않는다, 처음엔 닫힘) */
  membersDrawerOpen: boolean;
  /** 휴대폰 화면: 커뮤니티·채널 목록 서랍을 열었는지 */
  navOpen: boolean;
  setMembersDrawer(open: boolean): void;
  setNavOpen(open: boolean): void;
  /** 서랍을 모두 닫는다 (바깥을 누르거나 다른 화면으로 옮길 때) */
  closeDrawers(): void;
}

export const useUiStore = create<UiState>((set, get) => ({
  membersHidden: readHidden(),
  toggleMembers: () => {
    const next = !get().membersHidden;
    try {
      localStorage.setItem(MEMBERS_HIDDEN_KEY, next ? '1' : '0');
    } catch {
      // 기억하지 못해도 지금 화면에는 적용된다.
    }
    set({ membersHidden: next });
  },
  membersDrawerOpen: false,
  navOpen: false,
  setMembersDrawer: (membersDrawerOpen) => set({ membersDrawerOpen, navOpen: false }),
  setNavOpen: (navOpen) => set({ navOpen, membersDrawerOpen: false }),
  closeDrawers: () => set({ navOpen: false, membersDrawerOpen: false }),
}));
