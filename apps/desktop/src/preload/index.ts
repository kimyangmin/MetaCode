import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopUpdateInfo, MetaCodeDesktopBridge, ScreenSource } from '@metacode/shared';

// sandbox 모드의 preload는 electron 일부 모듈만 require할 수 있다.
// 그래서 @metacode/shared는 타입만 가져오고, IPC 이름은 main/index.ts와 똑같이 적는다.
const IPC = {
  login: 'metacode:auth:login',
  logout: 'metacode:auth:logout',
  getAccessToken: 'metacode:auth:get-access-token',
  changed: 'metacode:auth:changed',
  download: 'metacode:download',
  screenSources: 'metacode:screen:sources',
  screenSelect: 'metacode:screen:select',
  updateReady: 'metacode:update:ready',
  updateGetReady: 'metacode:update:get-ready',
  updateInstall: 'metacode:update:install',
} as const;

const bridge: MetaCodeDesktopBridge = {
  platform: 'desktop',
  os: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
  },
  download: (url) => ipcRenderer.invoke(IPC.download, url) as Promise<void>,
  screen: {
    getSources: () => ipcRenderer.invoke(IPC.screenSources) as Promise<ScreenSource[]>,
    select: (sourceId) => ipcRenderer.invoke(IPC.screenSelect, sourceId) as Promise<void>,
  },
  update: {
    getReady: () => ipcRenderer.invoke(IPC.updateGetReady) as Promise<DesktopUpdateInfo | null>,
    onReady(listener) {
      const handler = (_event: unknown, info: DesktopUpdateInfo) => listener(info);
      ipcRenderer.on(IPC.updateReady, handler);
      return () => {
        ipcRenderer.removeListener(IPC.updateReady, handler);
      };
    },
    install: () => ipcRenderer.invoke(IPC.updateInstall) as Promise<void>,
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
