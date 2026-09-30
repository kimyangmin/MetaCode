/**
 * 서버 주소. 빌드할 때 EXPO_PUBLIC_API_URL로 바꿀 수 있다 (Expo가 코드에 넣어 줌).
 * 개발: 에뮬레이터는 PC의 localhost를 10.0.2.2로 보므로 `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000`,
 * 실제 휴대폰은 PC의 내부 IP나 `adb reverse tcp:3000 tcp:3000` 후 http://localhost:3000.
 */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? 'https://api.metacode.kimyangmin.me'
).replace(/\/$/, '');

/** 웹 주소. 초대 링크 공유 등에 쓴다 */
export const WEB_URL = (
  process.env.EXPO_PUBLIC_WEB_URL ?? 'https://metacode.kimyangmin.me'
).replace(/\/$/, '');
