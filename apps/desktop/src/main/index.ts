import path from 'node:path';
import { BrowserWindow, type IpcMainInvokeEvent, app, ipcMain, shell } from 'electron';
import { AuthManager } from './auth';
import { createTokenStorage } from './token-storage';

// 개발 모드에서는 web 개발 서버를, 그 외에는 web 빌드 결과를 띄운다.
const DEV_SERVER_URL = process.env.METACODE_WEB_URL ?? 'http://localhost:5173';
const API_URL = process.env.METACODE_API_URL ?? 'http://localhost:3000';
const isDev = !app.isPackaged;

// preload와 같은 이름을 써야 한다 (sandbox preload는 이 파일을 import할 수 없다).
const IPC = {
  login: 'metacode:auth:login',
  logout: 'metacode:auth:logout',
  getAccessToken: 'metacode:auth:get-access-token',
  changed: 'metacode:auth:changed',
} as const;

let mainWindow: BrowserWindow | null = null;
let auth: AuthManager | null = null;

function isAppUrl(url: string): boolean {
  return isDev ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://');
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'MetaCode',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 외부 링크는 앱 창이 아니라 시스템 브라우저로 연다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  if (isDev) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../../../web/dist/index.html'));
  }

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
  ipcMain.handle(IPC.getAccessToken, (event) => (fromApp(event) ? manager.getAccessToken() : null));
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
      storage: createTokenStorage(),
      openExternal: (url) => shell.openExternal(url),
      onChanged: () => mainWindow?.webContents.send(IPC.changed),
      onReturned: focusMainWindow,
      log: (message) => console.log(`[auth] ${message}`),
    });
    registerIpc(auth);
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
