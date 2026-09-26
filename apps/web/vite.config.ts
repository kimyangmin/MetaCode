import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Electron이 빌드 결과를 file://로 열 수 있도록 상대 경로를 쓴다.
  base: './',
  // 모노레포 루트의 .env에서 VITE_ 변수를 읽는다.
  envDir: '../..',
  server: {
    port: 5173,
    strictPort: true,
  },
});
