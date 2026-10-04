import { describe, expect, it } from 'vitest';
import { compareVersions, newerRelease, type ReleaseInfo } from './appVersion';

const release = (tag: string, extra: Partial<ReleaseInfo> = {}): ReleaseInfo => ({
  tag_name: tag,
  html_url: `https://example.com/${tag}`,
  draft: false,
  prerelease: false,
  ...extra,
});

describe('compareVersions', () => {
  it('자리마다 숫자로 비교한다', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });
});

describe('newerRelease', () => {
  it('지금보다 새 안드로이드 Release 중 가장 새 것을 고른다', () => {
    const releases = [
      release('desktop-v9.0.0'),
      release('android-v1.0.1'),
      release('android-v1.2.0'),
      release('android-v1.3.0', { prerelease: true }),
      release('android-v0.1.0'),
    ];
    expect(newerRelease(releases, '1.0.0')).toEqual({
      version: '1.2.0',
      url: 'https://example.com/android-v1.2.0',
    });
  });

  it('새 것이 없으면 null', () => {
    expect(
      newerRelease([release('android-v1.0.0'), release('android-v0.1.0')], '1.0.0'),
    ).toBeNull();
  });
});
