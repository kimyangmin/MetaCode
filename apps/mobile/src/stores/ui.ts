import { create } from 'zustand';

interface UiState {
  /** 왼쪽 서랍: 커뮤니티 막대 + 채널·DM 목록 */
  navOpen: boolean;
  /** 오른쪽 서랍: 멤버 목록 (커뮤니티) */
  membersOpen: boolean;
  /** 채널 화면 위쪽의 광장 (끄면 채팅만). 앱을 켜 둔 동안 기억한다 */
  plazaOpen: boolean;
  /** 광장 높이 (dp). null이면 화면의 40% */
  plazaHeight: number | null;
  setPlazaOpen(open: boolean): void;
  setPlazaHeight(height: number): void;
  setNavOpen(open: boolean): void;
  setMembersOpen(open: boolean): void;
  closeDrawers(): void;
}

/** 서랍 상태 (웹 stores/ui.ts의 휴대폰 서랍과 같은 규칙: 한쪽을 열면 다른 쪽은 닫는다) */
export const useUiStore = create<UiState>((set) => ({
  navOpen: false,
  membersOpen: false,
  plazaOpen: true,
  plazaHeight: null,
  setPlazaOpen: (plazaOpen) => set({ plazaOpen }),
  setPlazaHeight: (plazaHeight) => set({ plazaHeight }),
  setNavOpen: (navOpen) => set(navOpen ? { navOpen, membersOpen: false } : { navOpen }),
  setMembersOpen: (membersOpen) =>
    set(membersOpen ? { membersOpen, navOpen: false } : { membersOpen }),
  closeDrawers: () => set({ navOpen: false, membersOpen: false }),
}));
