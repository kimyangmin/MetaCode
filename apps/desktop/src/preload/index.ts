import { contextBridge, ipcRenderer } from 'electron';
import type { MetaCodeDesktopBridge } from '@metacode/shared';

// sandbox 모드의 preload는 electron 일부 모듈만 require할 수 있다.
// 그래서 @metacode/shared는 타입만 가져오고, IPC 이름은 main/index.ts와 똑같이 적는다.
const IPC = {
  login: 'metacode:auth:login',
  logout: 'metacode:auth:logout',
  getAccessToken: 'metacode:auth:get-access-token',
  changed: 'metacode:auth:changed',
} as const;

const bridge: MetaCodeDesktopBridge = {
  platform: 'desktop',
  os: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
  },
  auth: {
    login: () => ipcRenderer.invoke(IPC.login) as Promise<void>,
    logout: () => ipcRenderer.invoke(IPC.logout) as Promise<void>,
    getAccessToken: () => ipcRenderer.invoke(IPC.getAccessToken) as Promise<string | null>,
    onChanged(listener) {
      const handler = () => listener();
      ipcRenderer.on(IPC.changed, handler);
      return () => {
        ipcRenderer.removeListener(IPC.changed, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('metacode', bridge);
