// Metro 설정: Expo 기본값 + 모노레포에서 한 벌만 있어야 하는 라이브러리를 앱 것으로 고정한다.
//
// packages/client는 zustand(온라인·입력 중 스토어)를 쓰는데, pnpm은 그 peer인 react를 client 자신의
// 개발 의존성(웹과 같은 react 19.3)으로 잇는다. 그대로 묶으면 앱(react 19.2, Expo가 정한 버전) 안에 React가
// 두 벌 들어가 그 스토어의 훅이 "Invalid hook call"로 죽는다 (expo-doctor가 잡음).
// 아래 라이브러리는 누가 불러도 앱 폴더 기준으로 찾게 한다.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const SINGLETONS = ['react', 'react-native', 'zustand', '@tanstack/react-query'];
const appOrigin = path.join(__dirname, 'package.json');
const upstream = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  const singleton = SINGLETONS.some(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );
  return singleton
    ? resolve({ ...context, originModulePath: appOrigin }, moduleName, platform)
    : resolve(context, moduleName, platform);
};

module.exports = config;
