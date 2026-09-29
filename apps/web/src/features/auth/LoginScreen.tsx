import { useState } from 'react';
import { login } from './auth';

export function LoginScreen({ error }: { error: string | null }) {
  const [pending, setPending] = useState(false);

  const onLogin = async () => {
    setPending(true);
    try {
      await login();
    } finally {
      // 웹은 페이지를 떠나고, 데스크톱·안드로이드는 브라우저에서 로그인하는 동안 다시 누를 수 있게 둔다.
      setPending(false);
    }
  };

  return (
    <main className="login">
      <h1>MetaCode</h1>
      <p className="login__tagline">채팅과 메타버스를 한 화면에서</p>
      {error && (
        <p className="login__error" role="alert">
          {error}
        </p>
      )}
      <button className="button button--primary" onClick={onLogin} disabled={pending}>
        GitHub로 로그인
      </button>
    </main>
  );
}
