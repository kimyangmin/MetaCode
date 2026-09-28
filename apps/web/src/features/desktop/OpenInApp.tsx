import { useEffect } from 'react';
import { DESKTOP_DOWNLOAD_URL } from '../../config';
import { appInviteUrl } from './inviteLink';

/** 같은 초대로 두 번 열지 않게 (개발 모드의 effect 두 번 실행 등) */
const opened = new Set<string>();

/**
 * 초대 링크를 설치한 데스크톱 앱으로 여는 화면. 들어오자마자 한 번 열어 보고
 * (브라우저가 "MetaCode 열기" 확인을 띄움), 앱이 없거나 열리지 않으면 브라우저에서 계속한다.
 */
export function OpenInApp({ code, onContinue }: { code: string; onContinue(): void }) {
  useEffect(() => {
    if (opened.has(code)) return;
    opened.add(code);
    window.location.href = appInviteUrl(code);
  }, [code]);

  return (
    <main className="login">
      <h1>MetaCode</h1>
      <p className="login__tagline">데스크톱 앱에서 초대를 여는 중…</p>
      <a className="button button--primary" href={appInviteUrl(code)}>
        앱에서 열기
      </a>
      <button type="button" className="button" onClick={onContinue}>
        브라우저에서 계속
      </button>
      <p className="form__hint">
        앱이 없나요?{' '}
        <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer">
          데스크톱 앱 받기
        </a>
      </p>
    </main>
  );
}
