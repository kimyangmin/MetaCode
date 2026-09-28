import { describe, expect, it } from 'vitest';
import { deepLinkRoute, routeFromArgv } from './deeplink';

describe('deepLinkRoute', () => {
  it('초대 주소를 앱 화면 경로로 바꾼다', () => {
    expect(deepLinkRoute('metacode://invite/AbCd2345')).toBe('/invite/AbCd2345');
    expect(deepLinkRoute('metacode://invite/AbCd2345/')).toBe('/invite/AbCd2345');
  });

  it('초대가 아니거나 코드 형식이 틀리면 무시한다', () => {
    expect(deepLinkRoute('metacode://c/123')).toBeNull();
    expect(deepLinkRoute('metacode://invite/../../settings')).toBeNull();
    expect(deepLinkRoute('metacode://invite/ab')).toBeNull();
    expect(deepLinkRoute('metacode://invite/AbCd2345/extra')).toBeNull();
    expect(deepLinkRoute('https://metacode.kimyangmin.me/invite/AbCd2345')).toBeNull();
    expect(deepLinkRoute('not a url')).toBeNull();
  });
});

describe('routeFromArgv', () => {
  it('실행 인자 중 metacode:// 주소를 찾는다 (Windows는 두 번째 실행의 인자로 온다)', () => {
    const argv = [
      'C:\\MetaCode\\MetaCode.exe',
      '--allow-file-access',
      'metacode://invite/AbCd2345',
    ];
    expect(routeFromArgv(argv)).toBe('/invite/AbCd2345');
    expect(routeFromArgv(['MetaCode.exe'])).toBeNull();
  });
});
