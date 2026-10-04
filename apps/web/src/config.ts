export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** 초대 링크에 쓰는 웹 주소. 데스크톱(file://)에서는 빌드할 때 넣은 값을 쓴다. */
export function webUrl(): string {
  if (import.meta.env.VITE_WEB_URL) return import.meta.env.VITE_WEB_URL;
  const { protocol, origin } = window.location;
  return protocol.startsWith('http') ? origin : 'http://localhost:5173';
}

/** 데스크톱 앱 설치 파일을 받는 곳 (GitHub Releases의 최신 버전) */
export const DESKTOP_DOWNLOAD_URL = 'https://github.com/kimyangmin/MetaCode/releases/latest';

/**
 * 안드로이드 앱 APK를 받는 곳. 안드로이드 Release는 Latest로 올리지 않으므로(데스크톱 업데이트가 Latest를 봄)
 * `android-v` 태그의 Release만 골라 보여 준다.
 */
export const ANDROID_DOWNLOAD_URL =
  'https://github.com/kimyangmin/MetaCode/releases?q=android-v&expanded=true';
