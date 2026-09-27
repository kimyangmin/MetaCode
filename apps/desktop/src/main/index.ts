import path from 'node:path';
import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  app,
  desktopCapturer,
  ipcMain,
  session,
  shell,
} from 'electron';
import { AuthManager } from './auth';
import { allowPermission } from './permissions';
import { createTokenStorage } from './token-storage';
import { isPopoutUrl } from './windows';

/**
 * 앱 창은 웹 화면을 연다. 개발 중에는 web 개발 서버, 설치 파일로 배포한 앱은 운영 사이트다
 * (Slack, Discord처럼. 서버를 배포하면 앱 화면도 바로 최신이 된다). 환경변수로 바꿀 수 있다.
 */
const PRODUCTION = {
  web: 'https://metacode.kimyangmin.me',
  api: 'https://api.metacode.kimyangmin.me',
} as const;
const isDev = !app.isPackaged;
const WEB_URL = process.env.METACODE_WEB_URL ?? (isDev ? 'http://localhost:5173' : PRODUCTION.web);
const API_URL = process.env.METACODE_API_URL ?? (isDev ? 'http://localhost:3000' : PRODUCTION.api);
const WEB_ORIGIN = new URL(WEB_URL).origin;

// preload와 같은 이름을 써야 한다 (sandbox preload는 이 파일을 import할 수 없다).
const IPC = {
  login: 'metacode:auth:login',
  logout: 'metacode:auth:logout',
  getAccessToken: 'metacode:auth:get-access-token',
  changed: 'metacode:auth:changed',
  download: 'metacode:download',
  screenSources: 'metacode:screen:sources',
  screenSelect: 'metacode:screen:select',
} as const;

/** 인증이 필요한 첨부 파일 주소 */
const ATTACHMENTS_URL = `${API_URL}/attachments/`;

let mainWindow: BrowserWindow | null = null;
let auth: AuthManager | null = null;

/** 앱 화면(웹 주소와 같은 출처)인지. 브리지 호출, 권한, 창 이동을 이 기준으로 막는다 */
function isAppUrl(url: string): boolean {
  try {
    return new URL(url).origin === WEB_ORIGIN;
  } catch {
    return false;
  }
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/** 모든 앱 창(메인, 분리한 창)의 보안 설정. 원격 화면에 Node 권한을 주지 않는다 */
const webPreferences = () => ({
  preload: path.join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
});

/**
 * 창이 열거나 이동할 수 있는 곳을 막는다.
 * - 분리한 창(/popout/)은 같은 보안 설정의 앱 창으로 열고, 그 창에도 같은 규칙을 건다.
 * - 그 밖의 링크는 시스템 브라우저로 연다. 앱 화면 밖으로는 이동하지 못한다.
 */
function guardWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isPopoutUrl(url, WEB_ORIGIN)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          minWidth: 360,
          minHeight: 400,
          autoHideMenuBar: true,
          webPreferences: webPreferences(),
        },
      };
    }
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child) => guardWindow(child));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'MetaCode',
    webPreferences: webPreferences(),
  });
  guardWindow(win);

  void win.loadURL(WEB_URL);

  win.on('closed', () => {
    mainWindow = null;
  });
  return win;
}

/** 앱 화면에서 온 호출만 받는다. */
function fromApp(event: IpcMainInvokeEvent): boolean {
  return isAppUrl(event.senderFrame?.url ?? '');
}

function registerIpc(manager: AuthManager) {
  ipcMain.handle(IPC.login, (event) => (fromApp(event) ? manager.login() : undefined));
  ipcMain.handle(IPC.logout, (event) => (fromApp(event) ? manager.logout() : undefined));
  // 첨부 파일 주소만 내려받는다 (렌더러가 임의의 주소를 내려받게 하지 않는다).
  ipcMain.handle(IPC.download, (event, url: unknown) => {
    if (!fromApp(event) || typeof url !== 'string' || !url.startsWith(ATTACHMENTS_URL)) return;
    mainWindow?.webContents.downloadURL(url);
  });
  ipcMain.handle(IPC.getAccessToken, (event) => (fromApp(event) ? manager.getAccessToken() : null));
}

/**
 * <img>나 다운로드는 Authorization 헤더를 직접 붙일 수 없다. 데스크톱은 쿠키 대신 Bearer 토큰을 쓰므로,
 * 첨부 파일 요청에 한해 메인 프로세스가 토큰을 붙여 준다.
 */
function attachAuthHeader(manager: AuthManager) {
  const { protocol, hostname } = new URL(API_URL);
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${protocol}//${hostname}/attachments/*`] },
    (details, callback) => {
      // 필터는 포트를 가리지 않으므로 정확한 주소인지 한 번 더 본다.
      if (!details.url.startsWith(ATTACHMENTS_URL)) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }
      void manager.getAccessToken().then((token) => {
        if (token) details.requestHeaders.Authorization = `Bearer ${token}`;
        callback({ requestHeaders: details.requestHeaders });
      });
    },
  );
}

/** 고른 화면은 이 시간 안에 쓰지 않으면 잊는다 (화면 공유를 누르지 않고 창만 닫은 경우) */
const SCREEN_SELECTION_TTL_MS = 30_000;
let screenSelection: { id: string; at: number } | null = null;

/**
 * 화면 공유. Electron은 getDisplayMedia에서 고르는 창을 띄우지 않으므로, 웹 화면이 목록(screenSources)을
 * 보여 주고 고른 것(screenSelect)을 알려 준 뒤 getDisplayMedia를 부른다. 앱 화면의 요청만 받는다.
 */
function registerScreenShare() {
  ipcMain.handle(IPC.screenSources, async (event) => {
    if (!fromApp(event)) return [];
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: source.thumbnail.toDataURL(),
    }));
  });
  ipcMain.handle(IPC.screenSelect, (event, id: unknown) => {
    if (fromApp(event) && typeof id === 'string') screenSelection = { id, at: Date.now() };
  });
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const selection = screenSelection;
    screenSelection = null;
    const url = request.frame?.url || request.securityOrigin;
    if (!isAppUrl(url) || !selection || Date.now() - selection.at > SCREEN_SELECTION_TTL_MS) {
      callback({});
      return;
    }
    void desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const source = sources.find((s) => s.id === selection.id);
        if (!source) return callback({});
        // 시스템 소리는 Windows에서만 함께 보낼 수 있다.
        const audio = request.audioRequested && process.platform === 'win32';
        callback(audio ? { video: source, audio: 'loopback' } : { video: source });
      })
      .catch(() => callback({}));
  });
}

/** 권한은 앱 화면에만, 통화에 필요한 것만 준다 (permissions.ts) */
function restrictPermissions() {
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const url = details.requestingUrl || webContents.getURL();
      const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
      callback(allowPermission(permission, isAppUrl(url), mediaTypes));
    },
  );
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, origin, details) => {
    const mediaType = details.mediaType;
    const mediaTypes = mediaType && mediaType !== 'unknown' ? [mediaType] : [];
    return allowPermission(permission, isAppUrl(origin), mediaTypes);
  });
}

function main() {
  // 앱을 한 번 더 실행하면 새 창을 띄우지 않고 기존 창을 앞으로 가져온다.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', focusMainWindow);

  void app.whenReady().then(() => {
    auth = new AuthManager({
      apiUrl: API_URL,
      storage: createTokenStorage(API_URL),
      openExternal: (url) => shell.openExternal(url),
      onChanged: () => mainWindow?.webContents.send(IPC.changed),
      onReturned: focusMainWindow,
      log: (message) => console.log(`[auth] ${message}`),
    });
    registerIpc(auth);
    restrictPermissions();
    registerScreenShare();
    attachAuthHeader(auth);
    mainWindow = createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    });
  });

  app.on('before-quit', () => auth?.dispose());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

main();
