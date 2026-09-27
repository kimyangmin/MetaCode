import type { DesktopUpdateInfo } from '@metacode/shared';

/** 새 버전을 찾고 내려받는 쪽 (설치한 앱에서는 electron-updater). 테스트에서는 가짜를 넣는다 */
export interface UpdateSource {
  /** 새 버전이 있으면 뒤에서 내려받기 시작한다 */
  check(): Promise<unknown>;
  /** 앱을 닫고 받아 둔 새 버전을 설치한 뒤 다시 연다 */
  install(): void;
  onDownloaded(listener: (info: DesktopUpdateInfo) => void): void;
}

export interface UpdaterOptions {
  source: UpdateSource;
  /** 다 받았을 때 (앱 화면에 알린다) */
  onReady(info: DesktopUpdateInfo): void;
  log(message: string): void;
  /** 다시 확인하는 간격 */
  intervalMs: number;
}

/**
 * 자동 업데이트: 켤 때와 일정 간격으로 새 버전을 확인하고, 다 받으면 알린다.
 * 받은 뒤에는 더 확인하지 않는다. 사용자가 바로 다시 시작하지 않아도 앱을 끌 때 설치된다.
 */
export class Updater {
  private ready: DesktopUpdateInfo | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: UpdaterOptions) {}

  start() {
    this.options.source.onDownloaded((info) => {
      this.ready = info;
      this.stop();
      this.options.log(`${info.version} 받음`);
      this.options.onReady(info);
    });
    void this.check();
    this.timer = setInterval(() => void this.check(), this.options.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  getReady(): DesktopUpdateInfo | null {
    return this.ready;
  }

  /** 받아 둔 새 버전이 있을 때만 설치한다 */
  install(): boolean {
    if (!this.ready) return false;
    this.options.source.install();
    return true;
  }

  private async check() {
    if (this.ready) return;
    try {
      await this.options.source.check();
    } catch (err) {
      // 오프라인이거나 GitHub에 닿지 않으면 다음 간격에 다시 본다.
      this.options.log(`확인 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
