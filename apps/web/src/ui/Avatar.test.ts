import { describe, expect, it } from 'vitest';
import { largeAvatarUrl, retryUrl } from './Avatar';

describe('프로필 사진 다시 불러오기', () => {
  it('처음에는 원래 주소, 다시 시도할 때마다 다른 주소', () => {
    expect(retryUrl('https://gh/u/1', 0)).toBe('https://gh/u/1');
    expect(retryUrl('https://gh/u/1', 2)).toBe('https://gh/u/1?retry=2');
    expect(retryUrl('https://gh/u/1?v=4', 1)).toBe('https://gh/u/1?v=4&retry=1');
  });
});

describe('크게 보기 사진 주소', () => {
  it('GitHub 사진은 크기를 붙이고, 올린 사진은 그대로', () => {
    expect(
      largeAvatarUrl({
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        avatarAnimatedUrl: null,
      }),
    ).toBe('https://avatars.githubusercontent.com/u/1?v=4&s=512');
    expect(
      largeAvatarUrl({
        avatarUrl: 'https://api.example/avatars/u/a.webp',
        avatarAnimatedUrl: null,
      }),
    ).toBe('https://api.example/avatars/u/a.webp');
  });

  it('움직이는 사진이 있으면 그것', () => {
    expect(
      largeAvatarUrl({
        avatarUrl: 'https://api.example/avatars/u/a.webp',
        avatarAnimatedUrl: 'https://api.example/avatars/u/a-animated.webp',
      }),
    ).toBe('https://api.example/avatars/u/a-animated.webp');
  });
});
