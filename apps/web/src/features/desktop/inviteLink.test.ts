import { beforeEach, describe, expect, it } from 'vitest';
import { inviteToOpenInApp, stayInBrowser } from './inviteLink';

const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0';
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15';

describe('inviteToOpenInApp', () => {
  beforeEach(() => sessionStorage.clear());

  it('Windows 브라우저의 초대 링크면 앱으로 열어 본다', () => {
    expect(inviteToOpenInApp('/invite/AbCd2345', windows, false)).toBe('AbCd2345');
  });

  it('데스크톱 앱 안, 다른 OS, 초대가 아닌 주소는 하지 않는다', () => {
    expect(inviteToOpenInApp('/invite/AbCd2345', windows, true)).toBeNull();
    expect(inviteToOpenInApp('/invite/AbCd2345', mac, false)).toBeNull();
    expect(inviteToOpenInApp('/c/123', windows, false)).toBeNull();
    expect(inviteToOpenInApp('/invite/a b', windows, false)).toBeNull();
  });

  it('브라우저에서 계속하기로 한 초대는 다시 묻지 않는다', () => {
    stayInBrowser('AbCd2345');
    expect(inviteToOpenInApp('/invite/AbCd2345', windows, false)).toBeNull();
    expect(inviteToOpenInApp('/invite/Other999', windows, false)).toBe('Other999');
  });
});
