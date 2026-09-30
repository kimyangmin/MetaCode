import { defineConfig } from 'vitest/config';

// 화면이 없는 로직(파서, 계산, 상태)만 Node에서 확인한다. React Native 모듈은 테스트에서 vi.mock으로 바꾼다.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
