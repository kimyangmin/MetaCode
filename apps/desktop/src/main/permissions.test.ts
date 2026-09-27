import { describe, expect, it } from 'vitest';
import { allowPermission } from './permissions';

describe('allowPermission', () => {
  it('앱 화면의 마이크 요청은 허락한다', () => {
    expect(allowPermission('media', true, ['audio'])).toBe(true);
    // 장치 목록 확인(종류 없음)도 허락한다.
    expect(allowPermission('media', true)).toBe(true);
  });

  it('화면 공유는 앱 화면에만 허락한다', () => {
    expect(allowPermission('display-capture', true)).toBe(true);
    expect(allowPermission('display-capture', false)).toBe(false);
  });

  it('카메라는 마이크와 함께 요청해도 거절한다', () => {
    expect(allowPermission('media', true, ['audio', 'video'])).toBe(false);
  });

  it('앱 화면이 아니면 무엇이든 거절한다', () => {
    expect(allowPermission('media', false, ['audio'])).toBe(false);
    expect(allowPermission('clipboard-sanitized-write', false)).toBe(false);
  });

  it('필요 없는 권한은 앱 화면이라도 거절한다', () => {
    for (const permission of ['geolocation', 'notifications', 'openExternal', 'midi']) {
      expect(allowPermission(permission, true)).toBe(false);
    }
  });
});
