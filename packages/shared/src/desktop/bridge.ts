/**
 * Electron preload가 `window.metacode`로 노출하는 브리지.
 * 웹 코드는 electron을 직접 import하지 않고 이 브리지만 쓴다. 브라우저에서는 undefined다.
 */
export interface MetaCodeDesktopBridge {
  platform: 'desktop';
  os: string;
  versions: {
    electron: string;
    chrome: string;
  };
}

declare global {
  interface Window {
    metacode?: MetaCodeDesktopBridge;
  }
}
