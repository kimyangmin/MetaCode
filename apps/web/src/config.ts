export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** 초대 링크에 쓰는 웹 주소. 데스크톱(file://)에서는 빌드할 때 넣은 값을 쓴다. */
export function webUrl(): string {
  if (import.meta.env.VITE_WEB_URL) return import.meta.env.VITE_WEB_URL;
  const { protocol, origin } = window.location;
  return protocol.startsWith('http') ? origin : 'http://localhost:5173';
}
