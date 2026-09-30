import type { MessageDto } from '@metacode/shared';
import { displayName, formatDay, formatTime, sameDay } from '@metacode/client';

/**
 * 채팅 영역 잡기(Ctrl+Shift). 목록은 최신 메시지부터이므로 위(↑)로 가면 번호가 커진다.
 * anchor는 잡기 시작한 메시지, focus는 지금 늘린 끝이다. 둘 사이(양 끝 포함)가 잡힌 범위다.
 */
export interface MessageRange {
  anchor: string;
  focus: string;
}

/** 잡힌 메시지들 (오래된 것부터). 둘 중 하나라도 목록에 없으면 빈 배열 */
export function rangeMessages(messages: MessageDto[], range: MessageRange): MessageDto[] {
  const a = messages.findIndex((m) => m.id === range.anchor);
  const f = messages.findIndex((m) => m.id === range.focus);
  if (a === -1 || f === -1) return [];
  return messages.slice(Math.min(a, f), Math.max(a, f) + 1).reverse();
}

/** id에서 한 칸 옮긴 메시지 id. up이면 화면 위(더 오래된 쪽), 아니면 아래(최신 쪽). 끝에서는 멈춘다 */
export function stepMessage(messages: MessageDto[], id: string, up: boolean): string {
  const index = messages.findIndex((m) => m.id === id);
  if (index === -1) return id;
  const next = Math.max(0, Math.min(messages.length - 1, index + (up ? 1 : -1)));
  return messages[next]!.id;
}

/** 복사할 대화 기록: 날짜가 바뀌면 날짜 줄, 메시지마다 "[시각] 이름: 내용" (첨부는 파일 이름) */
export function transcript(messages: MessageDto[]): string {
  const lines: string[] = [];
  messages.forEach((message, i) => {
    const previous = messages[i - 1];
    if (!previous || !sameDay(previous.createdAt, message.createdAt)) {
      lines.push(`── ${formatDay(message.createdAt)} ──`);
    }
    const files = message.attachments.map((a) => `📎 ${a.fileName}`);
    const body = [message.content, ...files].filter(Boolean).join(' ');
    lines.push(`[${formatTime(message.createdAt)}] ${displayName(message.author)}: ${body}`);
  });
  return lines.join('\n');
}

/**
 * Ctrl과 Shift를 함께 눌렀다 뗐는지 (그 사이 다른 키를 누르지 않았을 때만).
 * 누르는 순간이 아니라 뗄 때 알리므로 Ctrl+Shift+Z 같은 단축키는 방해하지 않는다.
 */
export function createModifierChord(onChord: () => void) {
  let armed = false;
  return {
    keydown(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>) {
      const modifier = e.key === 'Control' || e.key === 'Shift';
      if (!modifier) {
        armed = false;
        return;
      }
      armed = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
    },
    keyup(e: Pick<KeyboardEvent, 'key'>) {
      if ((e.key === 'Control' || e.key === 'Shift') && armed) {
        armed = false;
        onChord();
      }
    },
    reset() {
      armed = false;
    },
  };
}
