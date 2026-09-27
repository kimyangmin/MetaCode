import type { MessageDto, UserProfile } from '@metacode/shared';
import { Fragment, useEffect, useRef } from 'react';
import { Avatar } from '../../ui/Avatar';
import { displayName, formatDay, formatTime, sameDay } from '../../ui/format';
import { MessageAttachments } from './MessageAttachments';

/** 같은 사람이 이 시간 안에 이어서 보낸 메시지는 이름/아바타 없이 붙여 보여준다. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface PendingMessage {
  clientId: string;
  content: string;
  /** 함께 보내는 첨부 (다시 보낼 때도 같은 첨부를 쓴다) */
  attachmentIds: string[];
  status: 'sending' | 'failed';
}

interface MessageListProps {
  /** 최신 메시지부터 */
  messages: MessageDto[];
  pending: PendingMessage[];
  me: UserProfile;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore(): void;
  onRetry(clientId: string): void;
  emptyText: string;
}

/**
 * 메시지 목록. column-reverse로 그려서 스크롤 기준점이 맨 아래가 되게 한다.
 * - 새 메시지가 오면 맨 아래에 있을 때는 자연스럽게 따라 내려가고, 위를 보고 있을 때는 그대로 둔다.
 * - 위쪽 끝(DOM의 마지막)에 닿으면 이전 기록을 불러오고, 스크롤 위치가 튀지 않는다.
 */
export function MessageList(props: MessageListProps) {
  const { messages, pending, me, hasMore, loadingMore, onLoadMore } = props;
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !loadingMore) onLoadMore();
      },
      { rootMargin: '200px 0px 0px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  return (
    <div className="message-list" role="log" aria-live="polite">
      {pending.map((p) => (
        <div key={p.clientId} className="message message--pending" data-status={p.status}>
          <div className="message__gutter" />
          <div className="message__body">
            <p className="message__content">{p.content || `📎 파일 ${p.attachmentIds.length}개`}</p>
            {p.status === 'failed' && (
              <button className="message__retry" onClick={() => props.onRetry(p.clientId)}>
                전송 실패 · 다시 보내기
              </button>
            )}
          </div>
        </div>
      ))}

      {messages.map((message, i) => {
        // messages는 최신부터이므로 시간상 바로 앞 메시지는 i + 1번째다.
        const previous = messages[i + 1];
        const newDay = !previous || !sameDay(previous.createdAt, message.createdAt);
        const grouped =
          !newDay &&
          previous.author.id === message.author.id &&
          Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_WINDOW_MS;
        return (
          <Fragment key={message.id}>
            <MessageItem message={message} grouped={grouped} mine={message.author.id === me.id} />
            {newDay && (
              <div className="day-divider" role="separator">
                <span>{formatDay(message.createdAt)}</span>
              </div>
            )}
          </Fragment>
        );
      })}

      {messages.length === 0 && pending.length === 0 && !hasMore && (
        <p className="message-list__empty">{props.emptyText}</p>
      )}
      <div ref={sentinel} className="message-list__top">
        {loadingMore && '이전 메시지를 불러오는 중…'}
      </div>
    </div>
  );
}

function MessageItem({
  message,
  grouped,
  mine,
}: {
  message: MessageDto;
  grouped: boolean;
  mine: boolean;
}) {
  return (
    <article className="message" data-grouped={grouped} data-mine={mine}>
      <div className="message__gutter">
        {grouped ? (
          <time className="message__hover-time" dateTime={message.createdAt}>
            {formatTime(message.createdAt)}
          </time>
        ) : (
          <Avatar user={message.author} size={36} />
        )}
      </div>
      <div className="message__body">
        {!grouped && (
          <header className="message__header">
            <strong>{displayName(message.author)}</strong>
            <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          </header>
        )}
        {message.content && <p className="message__content">{message.content}</p>}
        <MessageAttachments attachments={message.attachments} />
      </div>
    </article>
  );
}
