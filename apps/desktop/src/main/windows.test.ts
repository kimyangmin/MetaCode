import { describe, expect, it } from 'vitest';
import { isPopoutUrl, isScreenPopup } from './windows';

const origin = 'https://metacode.kimyangmin.me';

describe('isPopoutUrl', () => {
  it('앱 출처의 /popout/ 주소만 앱 창으로 연다 (일반 주소와 해시 주소)', () => {
    expect(isPopoutUrl(`${origin}/popout/chat/1`, origin)).toBe(true);
    expect(isPopoutUrl(`${origin}/#/popout/plaza/dm:1`, origin)).toBe(true);
  });

  it('다른 출처나 다른 경로는 아니다', () => {
    expect(isPopoutUrl('https://evil.example/popout/chat/1', origin)).toBe(false);
    expect(isPopoutUrl(`${origin}/c/1`, origin)).toBe(false);
    expect(isPopoutUrl('not a url', origin)).toBe(false);
  });
});

describe('isScreenPopup', () => {
  it('화면 공유 보기 이름의 빈 창만 연다', () => {
    expect(isScreenPopup('about:blank', 'metacode-screen')).toBe(true);
    expect(isScreenPopup('about:blank', 'other')).toBe(false);
    expect(isScreenPopup('https://evil.example/', 'metacode-screen')).toBe(false);
  });
});
