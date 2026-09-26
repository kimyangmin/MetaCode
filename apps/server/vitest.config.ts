import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { testEnv } from './test/env.js';

export default defineConfig({
  // Nest DI는 데코레이터 메타데이터가 필요한데 Vitest 기본 변환(esbuild)은 만들지 못한다.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globalSetup: ['./test/global-setup.ts'],
    env: testEnv,
    // 테스트들이 같은 DB와 Redis를 쓰므로 파일을 순서대로 실행한다.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
