import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
