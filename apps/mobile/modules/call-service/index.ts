import { requireOptionalNativeModule } from 'expo';

interface CallServiceModule {
  start(title: string, text: string): void;
  stop(): void;
}

/**
 * 통화 유지 서비스 (안드로이드 포그라운드 서비스, 알림). 이 모듈이 없는 예전 개발 빌드에서는 아무것도 하지 않는다.
 */
const native = requireOptionalNativeModule<CallServiceModule>('CallService');

export function startCallService(title: string, text: string): void {
  try {
    native?.start(title, text);
  } catch {
    // 서비스를 켜지 못해도 앱이 앞에 있는 동안은 통화가 된다.
  }
}

export function stopCallService(): void {
  try {
    native?.stop();
  } catch {
    // 이미 멈춰 있다
  }
}
