import { create } from 'zustand';
import defaultSoundUrl from '../../assets/sounds/notification.mp3?url';

/**
 * 알림음. 기본은 앱에 넣은 소리이고, 설정 → 앱 설정에서 mp3를 골라 바꿀 수 있다. 고른 파일은 이 기기의
 * IndexedDB에 둔다 (localStorage에는 큰 파일을 넣을 수 없음). 서버에는 올리지 않는다.
 */

/** 알림음으로 고를 수 있는 파일 크기 */
export const SOUND_MAX_BYTES = 2 * 1024 * 1024;

const DB_NAME = 'metacode';
const STORE = 'sounds';
const RECORD = 'notification';

interface StoredSound {
  name: string;
  blob: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB를 열지 못했습니다.'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('알림음을 읽지 못했습니다.'));
    });
  } finally {
    db.close();
  }
}

interface SoundState {
  /** 직접 고른 알림음의 파일 이름 (기본이면 null) */
  customName: string | null;
  url: string;
}

export const useNotificationSound = create<SoundState>(() => ({
  customName: null,
  url: defaultSoundUrl,
}));

let objectUrl: string | null = null;

function apply(sound: StoredSound | undefined) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = sound ? URL.createObjectURL(sound.blob) : null;
  useNotificationSound.setState({
    customName: sound?.name ?? null,
    url: objectUrl ?? defaultSoundUrl,
  });
}

/** 저장해 둔 알림음을 불러온다 (앱을 켤 때, 다른 창에서 바꿨을 때) */
export async function loadNotificationSound(): Promise<void> {
  try {
    apply(await withStore<StoredSound | undefined>('readonly', (s) => s.get(RECORD)));
  } catch {
    apply(undefined);
  }
}

/** 알림음이 바뀌었다고 다른 창에 알린다 (그 창들이 다시 불러옴) */
const CHANNEL = 'metacode-notification-sound';
let channel: BroadcastChannel | null = null;
function soundChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => void loadNotificationSound();
  }
  return channel;
}

/** mp3 하나를 알림음으로 고른다. 문제가 있으면 글로 돌려준다 */
export async function setCustomSound(file: File): Promise<string | null> {
  const isMp3 = file.type === 'audio/mpeg' || /\.mp3$/i.test(file.name);
  if (!isMp3) return 'mp3 파일만 쓸 수 있습니다.';
  if (file.size > SOUND_MAX_BYTES) return '2MB 이하의 파일만 쓸 수 있습니다.';
  // 실제로 틀 수 있는 소리인지 먼저 본다
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio();
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error('bad'));
      audio.src = url;
    });
  } catch {
    return '이 파일을 틀 수 없습니다.';
  } finally {
    URL.revokeObjectURL(url);
  }
  const sound: StoredSound = { name: file.name, blob: file };
  try {
    await withStore('readwrite', (s) => s.put(sound, RECORD));
  } catch {
    return '알림음을 저장하지 못했습니다.';
  }
  apply(sound);
  soundChannel()?.postMessage('changed');
  return null;
}

/** 기본 알림음으로 되돌린다 */
export async function resetSound(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(RECORD));
  } catch {
    // 지우지 못해도 이 창은 기본으로 돌아간다.
  }
  apply(undefined);
  soundChannel()?.postMessage('changed');
}

/** 알림음을 튼다. 브라우저가 막으면(창을 아직 한 번도 누르지 않음 등) 조용히 넘어간다 */
export function playNotificationSound(volume: number): void {
  const audio = new Audio(useNotificationSound.getState().url);
  audio.volume = Math.min(1, Math.max(0, volume));
  void audio.play().catch(() => {});
}

// 다른 창에서 알림음을 바꾸면 따라간다.
soundChannel();
