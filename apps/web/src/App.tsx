import { useEffect, useState } from 'react';
import { API_URL } from './config';
import { getDesktopBridge } from './platform';

type ServerStatus = 'checking' | 'ok' | 'unreachable';

export function App() {
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const desktop = getDesktopBridge();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then((res) => setServerStatus(res.ok ? 'ok' : 'unreachable'))
      .catch(() => {
        if (!controller.signal.aborted) setServerStatus('unreachable');
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="app">
      <h1>MetaCode</h1>
      <dl>
        <dt>플랫폼</dt>
        <dd>
          {desktop ? `데스크톱 (${desktop.os}, Electron ${desktop.versions.electron})` : '웹'}
        </dd>
        <dt>서버</dt>
        <dd data-status={serverStatus}>{serverStatus}</dd>
      </dl>
    </main>
  );
}
