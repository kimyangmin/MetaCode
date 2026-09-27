import type { DesktopUpdateInfo } from '@metacode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type UpdateSource, Updater } from './updater';

const HOUR = 60 * 60 * 1000;

function fakeSource() {
  let downloaded: ((info: DesktopUpdateInfo) => void) | undefined;
  const source = {
    check: vi.fn(() => Promise.resolve()),
    install: vi.fn(),
    onDownloaded: (listener) => {
      downloaded = listener;
    },
  } satisfies UpdateSource;
  return { source, download: (version: string) => downloaded?.({ version }) };
}

function createUpdater(source: UpdateSource) {
  const onReady = vi.fn();
  const updater = new Updater({ source, onReady, log: () => {}, intervalMs: HOUR });
  return { updater, onReady };
}

describe('Updater', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('켤 때와 간격마다 확인하고, 다 받으면 알린 뒤 더 확인하지 않는다', () => {
    const { source, download } = fakeSource();
    const { updater, onReady } = createUpdater(source);
    updater.start();
    expect(source.check).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(HOUR);
    expect(source.check).toHaveBeenCalledTimes(2);

    download('0.2.1');
    expect(onReady).toHaveBeenCalledWith({ version: '0.2.1' });
    expect(updater.getReady()).toEqual({ version: '0.2.1' });

    vi.advanceTimersByTime(3 * HOUR);
    expect(source.check).toHaveBeenCalledTimes(2);
  });

  it('받아 둔 새 버전이 없으면 설치하지 않는다', () => {
    const { source, download } = fakeSource();
    const { updater } = createUpdater(source);
    updater.start();
    expect(updater.install()).toBe(false);
    expect(source.install).not.toHaveBeenCalled();

    download('0.2.1');
    expect(updater.install()).toBe(true);
    expect(source.install).toHaveBeenCalledTimes(1);
    updater.stop();
  });

  it('확인에 실패해도 멈추지 않고 다음 간격에 다시 본다', async () => {
    const { source } = fakeSource();
    source.check.mockRejectedValueOnce(new Error('offline'));
    const { updater } = createUpdater(source);
    updater.start();
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(source.check).toHaveBeenCalledTimes(2);
    updater.stop();
  });
});
