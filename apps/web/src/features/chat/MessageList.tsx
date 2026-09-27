import type { MessageDto, UserProfile } from '@metacode/shared';
import { Fragment, type MouseEvent, useEffect, useRef, useState } from 'react';
import { openProfile } from '../../stores/profile';
import { Avatar } from '../../ui/Avatar';
import { displayName, formatDay, formatTime, sameDay } from '../../ui/format';
import { splitLinks } from '../../ui/links';
import { MessageAttachments } from './MessageAttachments';
import { type MenuTarget, MessageMenu } from './MessageMenu';

/** 같은 사람이 이 시간 안에 이어서 보낸 메시지는 이름/아바타 없이 붙여 보여준다. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface PendingMessage {
  clientId: string;
  content: string;
  /** 함께 보내는 첨부 (다시 보낼 때도 같은 첨부를 쓴다) */
  attachmentIds: string[];
  replyToId?: string;
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
  /** 커뮤니티 채널이면 프로필 팝업에 그 커뮤니티의 역할을 보여 준다 */
  communityId?: string;
  onReply(message: MessageDto): void;
  onForward(message: MessageDto): void;
}

/**
 * 메시지 목록. column-reverse로 그려서 스크롤 기준점이 맨 아래가 되게 한다.
 * - 새 메시지가 오면 맨 아래에 있을 때는 자연스럽게 따라 내려가고, 위를 보고 있을 때는 그대로 둔다.
 * - 위쪽 끝(DOM의 마지막)에 닿으면 이전 기록을 불러오고, 스크롤 위치가 튀지 않는다.
 */
export function MessageList(props: MessageListProps) {
  const { messages, pending, me, hasMore, loadingMore, onLoadMore } = props;
  const sentinel = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);

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
            <MessageItem
              message={message}
              grouped={grouped}
              mine={message.author.id === me.id}
              communityId={props.communityId}
              onMenu={setMenu}
            />
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
      {menu && (
        <MessageMenu
          target={menu}
          onReply={props.onReply}
          onForward={props.onForward}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function MessageItem({
  message,
  grouped,
  mine,
  communityId,
  onMenu,
}: {
  message: MessageDto;
  grouped: boolean;
  mine: boolean;
  communityId?: string;
  onMenu(target: MenuTarget): void;
}) {
  const showProfile = (e: MouseEvent) => openProfile(message.author, e, communityId);
  const onContextMenu = (e: MouseEvent) => {
    // 글을 골라 둔 상태면 브라우저 기본 메뉴(복사 등)를 그대로 쓴다.
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
    const link = (e.target as HTMLElement).closest('a')?.href ?? null;
    onMenu({ message, x: e.clientX, y: e.clientY, link });
  };

  return (
    <article
      className="message"
      data-grouped={grouped && !message.replyTo}
      data-mine={mine}
      data-message-id={message.id}
      onContextMenu={onContextMenu}
    >
      {message.replyTo && <ReplyPreview reply={message.replyTo} />}
      <div className="message__gutter">
        {grouped && !message.replyTo ? (
          <time className="message__hover-time" dateTime={message.createdAt}>
            {formatTime(message.createdAt)}
          </time>
        ) : (
          <button
            type="button"
            className="message__avatar"
            onClick={showProfile}
            aria-label={`${displayName(message.author)} 정보`}
          >
            <Avatar user={message.author} size={36} />
          </button>
        )}
      </div>
      <div className="message__body">
        {!(grouped && !message.replyTo) && (
          <header className="message__header">
            <button type="button" className="message__author" onClick={showProfile}>
              {displayName(message.author)}
            </button>
            <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          </header>
        )}
        {message.forwarded && <p className="message__forwarded">↪ 전달된 메시지</p>}
        {message.content && (
          <p className="message__content">
            <LinkedText text={message.content} />
          </p>
        )}
        <MessageAttachments attachments={message.attachments} />
      </div>
    </article>
  );
}

/** 답장한 원래 메시지 (누르면 목록에 있을 때 그 메시지로 이동) */
function ReplyPreview({ reply }: { reply: NonNullable<MessageDto['replyTo']> }) {
  const jump = () => {
    const target = document.querySelector<HTMLElement>(`[data-message-id="${reply.id}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.dataset.highlight = 'true';
    setTimeout(() => delete target.dataset.highlight, 1500);
  };
  return (
    <button type="button" className="message__reply" onClick={jump} title="원래 메시지로 가기">
      <span aria-hidden>↩</span>
      <strong>{displayName(reply.author)}</strong>
      <span className="message__reply-text">
        {reply.content || (reply.attachmentCount > 0 ? `📎 파일 ${reply.attachmentCount}개` : '')}
      </span>
    </button>
  );
}

/** 글 속 http(s) 주소를 누를 수 있는 링크로 (새 창, 데스크톱은 시스템 브라우저) */
function LinkedText({ text }: { text: string }) {
  return splitLinks(text).map((part, i) =>
    part.type === 'link' ? (
      <a key={i} href={part.value} target="_blank" rel="noopener noreferrer">
        {part.value}
      </a>
    ) : (
      <Fragment key={i}>{part.value}</Fragment>
    ),
  );
}
