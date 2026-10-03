import type { ExpoConfig } from 'expo/config';
import pkg from './package.json';

/** 밤하늘 (MetaCode 팔레트). 아이콘 바탕, 시작 화면, 창 배경 */
const NIGHT = '#1B1E30';

/** 1.2.3 → 10203. 버전이 오르면 늘 커진다 (예전 Capacitor 앱 0.x 위에 덮어 설치된다) */
function versionCode(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return major * 10000 + minor * 100 + patch;
}

const config: ExpoConfig = {
  name: 'MetaCode',
  slug: 'metacode',
  version: pkg.version,
  orientation: 'portrait',
  icon: './assets/icon.png',
  // 초대 링크(metacode://invite/<코드>)와 로그인 결과(metacode://auth?code=)를 받는다
  scheme: 'metacode',
  userInterfaceStyle: 'automatic',
  backgroundColor: NIGHT,
  android: {
    // 예전 Capacitor 앱과 같은 패키지 이름·서명 키라 덮어 설치된다
    package: 'me.kimyangmin.metacode',
    versionCode: versionCode(pkg.version),
    adaptiveIcon: {
      backgroundColor: NIGHT,
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    'expo-secure-store',
    'expo-web-browser',
    'expo-font',
    [
      'expo-splash-screen',
      { image: './assets/splash-icon.png', imageWidth: 96, backgroundColor: NIGHT },
    ],
    ['expo-build-properties', { android: { minSdkVersion: 24 } }],
    // 채팅 첨부: 사진만 고른다 (카메라·마이크 권한은 받지 않음, 웹·데스크톱도 카메라를 쓰지 않음)
    ['expo-image-picker', { cameraPermission: false, microphonePermission: false }],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
