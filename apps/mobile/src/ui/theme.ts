import { useColorScheme } from 'react-native';

/** MetaCode 팔레트 (웹 styles.css의 --mc-*). 로그인 화면, 설정 등 */
export const mc = {
  night: '#1B1E30',
  ink: '#262B44',
  ember: '#FDBE53',
  fountain: '#2FA8E0',
  grass: '#84C669',
  dawn: '#E9EDF5',
} as const;

/** 웹 styles.css의 :root 토큰과 같은 값 (밝은 / 어두운 모드) */
const light = {
  bg: '#ffffff',
  bgSidebar: '#f6f8fa',
  bgRail: '#e7ebef',
  bgHover: '#eaeef2',
  bgActive: '#dde3ea',
  bgInput: '#f1f3f5',
  fg: '#1f2328',
  muted: '#59636e',
  border: '#d1d9e0',
  accent: '#1f6feb',
  accentFg: '#ffffff',
  danger: '#cf222e',
  ok: '#1a7f37',
  warn: '#9a6700',
};

export type Theme = typeof light;

const dark: Theme = {
  bg: '#0d1117',
  bgSidebar: '#111620',
  bgRail: '#0a0d12',
  bgHover: '#1b2230',
  bgActive: '#232c3b',
  bgInput: '#161b26',
  fg: '#e6edf3',
  muted: '#9198a1',
  border: '#262d38',
  accent: '#388bfd',
  accentFg: '#ffffff',
  danger: '#f85149',
  ok: '#3fb950',
  warn: '#d29922',
};

export function useTheme(): Theme {
  return useColorScheme() === 'light' ? light : dark;
}
