import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appOpenMethod, desktopOs, inviteToOpenInApp, stayInBrowser } from './inviteLink';

const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0';
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15';
const macChrome =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
const linux = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile';
const chromeOs = 'Mozilla/5.0 (X11; CrOS x86_64 16000.0) AppleWebKit/537.36 Chrome/140.0';

describe('inviteToOpenInApp', () => {
  // 테스트는 Node에서 돌아서 전역 sessionStorage가 없다.
  beforeEach(() => {
    const items = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Windows·macOS·Linux 브라우저의 초대 링크면 앱으로 열어 본다', () => {
    for (const ua of [windows, mac, macChrome, linux]) {
      expect(inviteToOpenInApp('/invite/AbCd2345', ua, false, 0)).toBe('AbCd2345');
    }
  });

  it('데스크톱 앱 안, 앱이 없는 기기(iPad·Android·ChromeOS), 초대가 아닌 주소는 하지 않는다', () => {
    expect(inviteToOpenInApp('/invite/AbCd2345', windows, true)).toBeNull();
    // iPadOS Safari는 Mac이라고 알린다
    expect(inviteToOpenInApp('/invite/AbCd2345', mac, false, 5)).toBeNull();
    expect(inviteToOpenInApp('/invite/AbCd2345', android, false)).toBeNull();
    expect(inviteToOpenInApp('/invite/AbCd2345', chromeOs, false)).toBeNull();
    expect(inviteToOpenInApp('/c/123', windows, false)).toBeNull();
    expect(inviteToOpenInApp('/invite/a b', windows, false)).toBeNull();
  });

  it('브라우저에서 계속하기로 한 초대는 다시 묻지 않는다', () => {
    stayInBrowser('AbCd2345');
    expect(inviteToOpenInApp('/invite/AbCd2345', windows, false)).toBeNull();
    expect(inviteToOpenInApp('/invite/Other999', windows, false)).toBe('Other999');
  });
});

describe('desktopOs', () => {
  it('앱을 설치할 수 있는 OS를 고른다', () => {
    expect(desktopOs(windows)).toBe('windows');
    expect(desktopOs(mac)).toBe('mac');
    expect(desktopOs(linux)).toBe('linux');
    expect(desktopOs(android)).toBeNull();
    expect(desktopOs(chromeOs)).toBeNull();
  });
});

describe('appOpenMethod', () => {
  it('Chromium 계열은 페이지를 옮기고, Safari·Firefox는 숨긴 iframe으로 연다', () => {
    expect(appOpenMethod(windows)).toBe('navigate');
    expect(appOpenMethod(macChrome)).toBe('navigate');
    expect(appOpenMethod(mac)).toBe('iframe');
    expect(appOpenMethod(linux)).toBe('iframe');
  });
});
