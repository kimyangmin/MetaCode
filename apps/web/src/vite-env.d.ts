/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WEB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** 이 웹 빌드의 번호 (vite.config.ts). version.json의 값과 다르면 새로 배포된 것이다 */
declare const __BUILD_ID__: string;
