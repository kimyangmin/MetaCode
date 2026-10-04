import { create } from 'zustand';

/** 로그인 전에 연 초대 링크의 코드. 로그인하면 그 초대 화면으로 이어 간다 (웹 sessionStorage와 같은 흐름) */
export const usePendingInvite = create<{ code: string | null }>(() => ({ code: null }));

/** 초대 코드 모양 (웹 parseAppLink와 같은 규칙: 글자 그대로 맞춘다) */
export const isInviteCode = (code: string | undefined): code is string =>
  !!code && /^[A-Za-z0-9]{4,32}$/.test(code);
