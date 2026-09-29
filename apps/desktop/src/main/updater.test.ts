import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoUpdate, UPDATE_CHECK_INTERVAL_MS, type UpdaterLike } from './updater';

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checkForUpdates = vi.fn(() => Promise.resolve(null));
  quitAndInstall = vi.fn();
}

function setup(manual = false) {
  const updater = new FakeUpdater();
  const onReady = vi.fn();
  const log = vi.fn();
  const updates = new AutoUpdate(updater, { onReady, log, manual });
  return { updater, updates, onReady, log };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AutoUpdate', () => {
  it('백그라운드에서 받고 앱을 끌 때 설치하도록 설정한다', () => {
    const { updater } = setup();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it('직접 설치해야 하는 앱은 받지 않고 새 버전이 있다는 것만 알린다', () => {
    const { updater, updates, onReady } = setup(true);
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    updater.emit('update-available', { version: '0.5.0' });
    expect(onReady).toHaveBeenCalledWith({ version: '0.5.0', manual: true });
    updates.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('스스로 설치하는 앱은 새 버전이 있다는 것만으로는 알리지 않는다 (다 받으면 알림)', () => {
    const { updater, onReady } = setup();
    updater.emit('update-available', { version: '0.5.0' });
    expect(onReady).not.toHaveBeenCalled();
  });

  it('시작할 때 한 번, 그 뒤로 간격마다 확인한다', () => {
    vi.useFakeTimers();
    const { updater, updates } = setup();
    updates.start();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    updates.dispose();
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('다 받으면 알리고, 나중에 물어봐도 알려 준다', () => {
    const { updater, updates, onReady } = setup();
    expect(updates.getReady()).toBeNull();
    updater.emit('update-downloaded', { version: '0.3.0' });
    expect(onReady).toHaveBeenCalledWith({ version: '0.3.0' });
    expect(updates.getReady()).toEqual({ version: '0.3.0' });
  });

  it('받아 둔 것이 있을 때만 설치한다', () => {
    const { updater, updates } = setup();
    updates.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    updater.emit('update-downloaded', { version: '0.3.0' });
    updates.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('확인에 실패해도 던지지 않고 기록만 한다', async () => {
    const { updater, updates, log } = setup();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    updates.start();
    updater.emit('error', new Error('offline'));
    await Promise.resolve();
    expect(log).toHaveBeenCalledWith('실패: offline');
    updates.dispose();
  });
});
