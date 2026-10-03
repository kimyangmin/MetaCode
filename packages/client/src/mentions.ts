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
