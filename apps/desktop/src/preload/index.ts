import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopWindowBridge,
  MetaCodeDesktopBridge,
  ScreenSource,
  UpdateReadyInfo,
} from '@metacode/shared';

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
  updateGetReady: 'metacode:update:get-ready',
  updateReady: 'metacode:update:ready',
  updateInstall: 'metacode:update:install',
  navigate: 'metacode:navigate',
  windowMinimize: 'metacode:window:minimize',
  windowToggleMaximize: 'metacode:window:toggle-maximize',
  windowClose: 'metacode:window:close',
  windowIsMaximized: 'metacode:window:is-maximized',
  windowMaximized: 'metacode:window:maximized',
} as const;

/**
 * 메인 창만 제목 표시줄을 웹이 그린다. 메인 프로세스가 창을 만들 때 넘긴 인자로 안다 (main/titlebar.ts의
 * TITLEBAR_ARG와 같은 이름). 인자가 없는 창(분리한 창)은 OS 제목 표시줄을 쓰므로 창 조작 브리지를 두지 않는다.
 */
const titleBar = process.argv
  .find((arg) => arg.startsWith('--metacode-titlebar='))
  ?.slice('--metacode-titlebar='.length);

const windowBridge: DesktopWindowBridge | undefined = titleBar
  ? {
      nativeControls: titleBar === 'native-controls',
      minimize: () => ipcRenderer.invoke(IPC.windowMinimize) as Promise<void>,
      toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize) as Promise<void>,
      close: () => ipcRenderer.invoke(IPC.windowClose) as Promise<void>,
      isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized) as Promise<boolean>,
      onMaximizedChange(listener) {
        const handler = (_event: unknown, maximized: unknown) => listener(maximized === true);
        ipcRenderer.on(IPC.windowMaximized, handler);
        return () => {
          ipcRenderer.removeListener(IPC.windowMaximized, handler);
        };
      },
    }
  : undefined;

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
  updates: {
    getReady: () => ipcRenderer.invoke(IPC.updateGetReady) as Promise<UpdateReadyInfo | null>,
    onReady(listener) {
      const handler = (_event: unknown, info: UpdateReadyInfo) => listener(info);
      ipcRenderer.on(IPC.updateReady, handler);
      return () => {
        ipcRenderer.removeListener(IPC.updateReady, handler);
      };
    },
    install: () => ipcRenderer.invoke(IPC.updateInstall) as Promise<void>,
  },
  navigation: {
    onNavigate(listener) {
      const handler = (_event: unknown, route: unknown) => {
        if (typeof route === 'string') listener(route);
      };
      ipcRenderer.on(IPC.navigate, handler);
      return () => {
        ipcRenderer.removeListener(IPC.navigate, handler);
      };
    },
  },
  window: windowBridge,
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
