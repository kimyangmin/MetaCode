import { describe, expect, it } from 'vitest';
import { canReloadNow, versionUrl } from './liveUpdate';

describe('웹 새 배포 반영', () => {
  it('절대 경로로 빌드한 웹만 version.json을 본다', () => {
    expect(versionUrl('/', 'https://metacode.kimyangmin.me')).toBe(
      'https://metacode.kimyangmin.me/version.json',
    );
    expect(versionUrl('./', 'file://')).toBeNull();
  });

  it('통화 중이거나 편집 중이거나 쓰던 글이 있으면 기다린다', () => {
    const idle = { inCall: false, editing: false, typing: false };
    expect(canReloadNow(idle)).toBe(true);
    expect(canReloadNow({ ...idle, inCall: true })).toBe(false);
    expect(canReloadNow({ ...idle, editing: true })).toBe(false);
    expect(canReloadNow({ ...idle, typing: true })).toBe(false);
  });
});
