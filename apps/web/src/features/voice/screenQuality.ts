import type { ScreenShareCaptureOptions, TrackPublishOptions } from 'livekit-client';

/**
 * 화면 공유 화질. 게임처럼 움직임이 많은 화면을 끊기지 않게 보내는 것이 목표라
 * 프레임을 우선하고(대역폭이 모자라면 해상도를 먼저 낮춤), 하드웨어 인코딩이 되는 H.264로 보낸다.
 * 사용하는 사람이 적어서(8명 안팎) 서버 부담보다 화질을 우선한다.
 */
export type ScreenQuality = 'smooth' | 'sharp' | 'best';

export const SCREEN_QUALITIES: Record<
  ScreenQuality,
  { label: string; detail: string; width: number; height: number; fps: number; bitrate: number }
> = {
  smooth: {
    label: '부드럽게',
    detail: '720p · 60fps',
    width: 1280,
    height: 720,
    fps: 60,
    bitrate: 4_000_000,
  },
  sharp: {
    label: '선명하게',
    detail: '1080p · 30fps',
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 6_000_000,
  },
  best: {
    label: '최고',
    detail: '1080p · 60fps',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrate: 9_000_000,
  },
};

export const DEFAULT_SCREEN_QUALITY: ScreenQuality = 'best';
const STORAGE_KEY = 'metacode:screen-quality';

export function readScreenQuality(): ScreenQuality {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved && saved in SCREEN_QUALITIES ? (saved as ScreenQuality) : DEFAULT_SCREEN_QUALITY;
  } catch {
    return DEFAULT_SCREEN_QUALITY;
  }
}

export function saveScreenQuality(quality: ScreenQuality): void {
  try {
    localStorage.setItem(STORAGE_KEY, quality);
  } catch {
    // 기억하지 못해도 이번 공유에는 적용된다.
  }
}

/** 화면을 잡을 때의 설정: 고른 해상도·프레임, 움직임 위주(contentHint: motion) */
export function captureOptions(quality: ScreenQuality): ScreenShareCaptureOptions {
  const preset = SCREEN_QUALITIES[quality];
  return {
    audio: true,
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
    resolution: { width: preset.width, height: preset.height, frameRate: preset.fps },
    contentHint: 'motion',
  };
}

/**
 * 보낼 때의 설정.
 * - H.264: 대부분의 PC가 하드웨어로 인코딩해서 게임을 하면서 공유해도 CPU를 덜 먹는다
 * - 시뮬캐스트 끔: 보는 사람이 적어 여러 화질을 따로 만들 필요가 없고, 그만큼 인코딩 부담이 준다
 * - maintain-framerate: 네트워크가 모자라면 해상도를 낮추고 프레임은 지킨다 (게임은 끊기는 것이 더 거슬림)
 */
export function publishOptions(quality: ScreenQuality): TrackPublishOptions {
  const preset = SCREEN_QUALITIES[quality];
  return {
    videoCodec: 'h264',
    simulcast: false,
    degradationPreference: 'maintain-framerate',
    screenShareEncoding: {
      maxBitrate: preset.bitrate,
      maxFramerate: preset.fps,
      priority: 'high',
    },
  };
}
