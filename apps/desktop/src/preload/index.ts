import { contextBridge } from 'electron';
import type { MetaCodeDesktopBridge } from '@metacode/shared';

// sandbox 모드의 preload는 electron 일부 모듈만 require할 수 있다.
// @metacode/shared는 타입만 가져오고 런타임 코드는 쓰지 않는다.
const bridge: MetaCodeDesktopBridge = {
  platform: 'desktop',
  os: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
  },
};

contextBridge.exposeInMainWorld('metacode', bridge);
