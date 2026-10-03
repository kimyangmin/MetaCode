import type { MessageDto, UserProfile } from '@metacode/shared';
import { extractMentions } from './markdownParser.js';

/** 나를 부른 메시지인지: @내아이디가 있거나, 내 메시지에 단 답장 (채팅 강조와 알림이 같이 씀) */
export function mentionsMe(
  message: Pick<MessageDto, 'author' | 'content' | 'replyTo'>,
  me: Pick<UserProfile, 'id' | 'username'>,
): boolean {
  if (message.author.id === me.id) return false;
  if (message.replyTo?.author.id === me.id) return true;
  return extractMentions(message.content).includes(me.username.toLowerCase());
}

/** 멘션 고르기 목록에 보일 사람 수 */
export const MENTION_LIST_MAX = 8;

/** 커서 바로 앞의 @입력 (멘션을 쓰는 중이면 그 시작 자리와 쓴 글자) */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|[\s(])@([A-Za-z0-9-]{0,39})$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[2]!.length - 1, query: match[2]! };
}

/** @뒤에 쓴 글자로 사람 찾기: 아이디가 그 글자로 시작하거나 닉네임에 그 글자가 있으면 */
export function mentionCandidates(
  people: readonly UserProfile[],
  query: string,
  meId: string,
): UserProfile[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  return people
    .filter((p) => {
      if (p.id === meId || seen.has(p.id)) return false;
      seen.add(p.id);
      return (
        p.username.toLowerCase().startsWith(q) || (p.displayName ?? '').toLowerCase().includes(q)
      );
    })
    .sort(
      (a, b) =>
        Number(!a.username.toLowerCase().startsWith(q)) -
        Number(!b.username.toLowerCase().startsWith(q)),
    )
    .slice(0, MENTION_LIST_MAX);
}

/** 고른 사람으로 쓰는 중인 @글자를 바꾼 글과 그 뒤 커서 자리 (@아이디 + 띄어쓰기) */
export function insertMention(
  text: string,
  mention: { start: number; query: string },
  username: string,
): { text: string; caret: number } {
  const end = mention.start + 1 + mention.query.length;
  const inserted = `@${username} `;
  return {
    text: text.slice(0, mention.start) + inserted + text.slice(end),
    caret: mention.start + inserted.length,
  };
}
