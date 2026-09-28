import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

/**
 * 빌드마다 다른 번호. 앱에 넣어 두고 같은 값을 version.json으로도 내보내서, 떠 있는 앱이
 * 새로 배포된 것을 알아채고 알아서 새로 불러오게 한다 (features/app/liveUpdate.ts).
 */
const BUILD_ID = new Date().toISOString();

function versionFile(): Plugin {
  return {
    name: 'metacode-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ build: BUILD_ID })}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // 기본은 Electron이 빌드 결과를 file://로 열 수 있도록 상대 경로.
  // 운영 웹(infra/caddy/Dockerfile)은 주소가 깊어져도 파일을 찾도록 WEB_BASE=/로 빌드한다.
  base: process.env.WEB_BASE ?? './',
  // 모노레포 루트의 .env에서 VITE_ 변수를 읽는다.
  envDir: '../..',
  build: {
    // Phaser(약 1.4MB)와 내장 에셋(약 150KB)은 광장을 처음 열 때 따로 불러오는 청크라
    // 첫 화면 크기와는 상관없다.
    chunkSizeWarningLimit: 1700,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
