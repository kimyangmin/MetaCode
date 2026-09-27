/** 말풍선에 보일 최대 글자 수. 넘으면 줄인다 (전체 내용은 채팅 모드에서 본다) */
export const BUBBLE_MAX_CHARS = 80;
/** 한 캐릭터 위에 동시에 쌓이는 최대 말풍선 수. 넘으면 오래된 것부터 사라진다 */
export const BUBBLE_MAX_STACK = 3;
const MIN_DURATION_MS = 3_000;
const MAX_DURATION_MS = 8_000;
const MS_PER_CHAR = 70;
/** 첨부 메시지의 임시 표시 시간 */
export const EMOTE_DURATION_MS = 2_500;

export interface Bubble {
  id: string;
  /** 채널 이름 (분수 광장에서 어느 채널에 쓴 글인지). DM 광장이면 없음 */
  label: string | null;
  text: string;
  kind: 'bubble' | 'attachment-emote';
  expiresAt: number;
}

/** 줄바꿈과 연속 공백을 한 칸으로 합치고, 길면 줄인다 (이모지 등 서로게이트 쌍을 자르지 않는다) */
export function bubbleText(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= BUBBLE_MAX_CHARS) return flat;
  return `${chars
    .slice(0, BUBBLE_MAX_CHARS - 1)
    .join('')
    .trimEnd()}…`;
}

/** 긴 글일수록 오래 보인다 */
export function bubbleDurationMs(text: string): number {
  return Math.min(
    MAX_DURATION_MS,
    Math.max(MIN_DURATION_MS, 1_500 + Array.from(text).length * MS_PER_CHAR),
  );
}

/**
 * 말풍선을 쌓는다. 연속으로 말하면 새 말풍선이 아래에 붙고 이전 것은 위로 밀리며,
 * 최대 개수를 넘으면 가장 오래된 것부터 뺀다. 이미 사라질 시간이 지난 것도 정리한다.
 */
export function pushBubble(stack: Bubble[], bubble: Bubble, now: number): Bubble[] {
  return [...activeBubbles(stack, now), bubble].slice(-BUBBLE_MAX_STACK);
}

export function activeBubbles(stack: Bubble[], now: number): Bubble[] {
  return stack.filter((b) => b.expiresAt > now);
}

/** 첨부 메시지의 임시 표시 글 (최종 모션은 Phase 6 에셋으로 바꾼다) */
export function emoteText(attachments: { kind: 'image' | 'file' }[]): string {
  const images = attachments.filter((a) => a.kind === 'image').length;
  if (images === attachments.length) return `🖼️ 사진 ${images}장`;
  return `📎 파일 ${attachments.length}개`;
}
