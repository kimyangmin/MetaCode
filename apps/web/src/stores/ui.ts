import { create } from 'zustand';
import {
  MEMBERS_WIDTH_DEFAULT,
  MEMBERS_WIDTH_MAX,
  MEMBERS_WIDTH_MIN,
} from '../layout/membersWidth';

const MEMBERS_HIDDEN_KEY = 'metacode:members-hidden';
const MEMBERS_WIDTH_KEY = 'metacode:members-width';

function readWidth(): number {
  try {
    const value = Number(localStorage.getItem(MEMBERS_WIDTH_KEY));
    if (value >= MEMBERS_WIDTH_MIN && value <= MEMBERS_WIDTH_MAX) return value;
  } catch {
    // 기억한 폭이 없으면 기본 폭
  }
  return MEMBERS_WIDTH_DEFAULT;
}

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
  /** 넓은 화면의 멤버 목록 폭 (왼쪽 가장자리를 끌어 바꾼다, 기억한다) */
  membersWidth: number;
  setMembersWidth(width: number): void;
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
  membersWidth: readWidth(),
  setMembersWidth: (membersWidth) => {
    try {
      localStorage.setItem(MEMBERS_WIDTH_KEY, String(membersWidth));
    } catch {
      // 기억하지 못해도 지금 화면에는 적용된다.
    }
    set({ membersWidth });
  },
  membersDrawerOpen: false,
  navOpen: false,
  // 한쪽 서랍을 열면 다른 쪽은 닫는다.
  setMembersDrawer: (membersDrawerOpen) =>
    set(membersDrawerOpen ? { membersDrawerOpen, navOpen: false } : { membersDrawerOpen }),
  setNavOpen: (navOpen) => set(navOpen ? { navOpen, membersDrawerOpen: false } : { navOpen }),
  closeDrawers: () => set({ navOpen: false, membersDrawerOpen: false }),
}));
