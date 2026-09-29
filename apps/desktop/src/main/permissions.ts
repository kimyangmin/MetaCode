/**
 * 앱 화면에 주는 권한: 통화 마이크, 화면 공유, 스피커 고르기, 클립보드 쓰기(초대 링크 복사),
 * 전체 화면(화면 공유 보기. 0.4.0까지는 빠져 있어서 전체 화면 버튼이 늘 거절되었음)
 */
const ALLOWED = new Set([
  'media',
  'display-capture',
  'clipboard-sanitized-write',
  'speaker-selection',
  'fullscreen',
]);

/**
 * 권한 요청을 허락할지. Electron은 처리기가 없으면 모든 권한을 허락하므로 직접 정한다.
 * 앱 화면이 아니면 모두 거절하고, 미디어는 마이크(audio)만 준다 (카메라는 쓰지 않음).
 * 화면 공유는 메인 프로세스의 setDisplayMediaRequestHandler가 사용자가 고른 화면만 넘겨준다.
 */
export function allowPermission(
  permission: string,
  fromApp: boolean,
  mediaTypes: readonly string[] = [],
): boolean {
  if (!fromApp || !ALLOWED.has(permission)) return false;
  if (permission === 'media') return mediaTypes.every((type) => type === 'audio');
  return true;
}
