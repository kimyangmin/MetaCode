import { describe, expect, it } from 'vitest';
import { retryUrl } from './Avatar';

describe('프로필 사진 다시 불러오기', () => {
  it('처음에는 원래 주소, 다시 시도할 때마다 다른 주소', () => {
    expect(retryUrl('https://gh/u/1', 0)).toBe('https://gh/u/1');
    expect(retryUrl('https://gh/u/1', 2)).toBe('https://gh/u/1?retry=2');
    expect(retryUrl('https://gh/u/1?v=4', 1)).toBe('https://gh/u/1?v=4&retry=1');
  });
});
