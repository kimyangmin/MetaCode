import { BrowserWindow, app, shell } from 'electron';
import path from 'node:path';

// 개발 모드에서는 web 개발 서버를, 그 외에는 web 빌드 결과를 띄운다.
const DEV_SERVER_URL = process.env.METACODE_WEB_URL ?? 'http://localhost:5173';
const isDev = !app.isPackaged;

function isAppUrl(url: string): boolean {
  return isDev ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://');
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

  return win;
}

void app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
