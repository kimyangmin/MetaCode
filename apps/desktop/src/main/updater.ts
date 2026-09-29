import type { UpdateReadyInfo } from '@metacode/shared';

/** 새 버전을 확인하는 간격. 앱을 켤 때 한 번, 그 뒤로는 이 간격마다 */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** electron-updater의 autoUpdater 중 쓰는 부분 (테스트에서 바꿔 끼운다) */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface AutoUpdateOptions {
  /**
   * 스스로 설치할 수 없는 앱: 받지 않고 새 버전이 있다는 것만 알린다 (웹이 "새 버전 받기"를 띄움).
   * 서명하지 않은 macOS 앱(Squirrel.Mac은 서명을 확인함)과 deb로 설치한 Linux 앱.
   */
  manual?: boolean;
  /** 새 버전을 다 받았을 때. 앱 화면에 "다시 시작" 안내를 띄운다 */
  onReady(info: UpdateReadyInfo): void;
  log(message: string): void;
}

/**
 * 자동 업데이트. 새 버전(GitHub Releases, electron-builder.yml의 publish)을 백그라운드에서 받아 두고,
 * 사용자가 "다시 시작"을 누르거나 앱을 끌 때 설치한다. 코드 서명을 하지 않아서 서명 확인은 하지 않는다
 * (electron-builder.yml에 publisherName이 없으면 electron-updater가 확인하지 않음).
 */
export class AutoUpdate {
  private ready: UpdateReadyInfo | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly updater: UpdaterLike,
    private readonly options: AutoUpdateOptions,
  ) {
    const manual = options.manual ?? false;
    updater.autoDownload = !manual;
    updater.autoInstallOnAppQuit = !manual;
    if (manual) {
      updater.on('update-available', (info) => {
        this.ready = { version: info.version, manual: true };
        options.log(`${info.version} 있음 (직접 설치)`);
        options.onReady(this.ready);
      });
    }
    updater.on('update-downloaded', (info) => {
      this.ready = { version: info.version };
      options.log(`${info.version} 받음`);
      options.onReady(this.ready);
    });
    // 확인이나 받기에 실패해도 앱은 그대로 쓴다. 다음 확인 때 다시 시도한다.
    updater.on('error', (error) => options.log(`실패: ${error.message}`));
  }

  start() {
    this.check();
    this.timer = setInterval(() => this.check(), UPDATE_CHECK_INTERVAL_MS);
  }

  /** 받아 둔 새 버전. 없으면 null */
  getReady(): UpdateReadyInfo | null {
    return this.ready;
  }

  /** 앱을 끄고 새 버전을 설치한 뒤 다시 켠다. 받아 둔 것이 없으면 아무것도 하지 않는다 */
  install() {
    // 직접 설치해야 하는 앱은 웹 화면이 설치 파일 받는 곳을 연다.
    if (!this.ready || this.ready.manual) return;
    // 설치 창 없이(oneClick NSIS) 설치하고 앱을 다시 켠다.
    this.updater.quitAndInstall(true, true);
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private check() {
    // 실패는 'error' 이벤트로도 오므로 거기서만 남긴다.
    this.updater.checkForUpdates().catch(() => undefined);
  }
}
