import { mentionsMe } from '../notifications/notify';
import {
  MESSAGE_MAX_LENGTH,
  type MessageDto,
  SocketEvent,
  type SocketAck,
  type UserProfile,
} from '@metacode/shared';
import {
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type AppSocket, useRealtime } from '../../realtime/RealtimeProvider';
import { openProfile } from '../../stores/profile';
import { Avatar } from '../../ui/Avatar';
import { PHONE_QUERY, isTouchDevice } from '../../ui/useMediaQuery';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { isManager } from '@metacode/shared';
import { useCommunities } from '../communities/hooks';
import { forgetOwnDeletion, markOwnDeletion } from './ashEffect';
import { displayName, formatDay, formatTime, sameDay, markdownToPlain } from '@metacode/client';
import { copyText } from '../../ui/clipboard';
import { Markdown, MentionContext, type MentionResolver } from '../../ui/Markdown';
import { MessageAttachments } from './MessageAttachments';
import { useSwipeToReply } from './swipeReply';
import { type MenuTarget, MessageMenu } from './MessageMenu';
import {
  type MessageRange,
  createModifierChord,
  rangeMessages,
  stepMessage,
  transcript,
} from './messageSelection';
import { ArrowDown, Forward, Reply, X } from 'lucide-react';
import { FileCount } from '../../ui/icons';

/** 같은 사람이 이 시간 안에 이어서 보낸 메시지는 이름/아바타 없이 붙여 보여준다. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;
/** 맨 아래에서 이만큼(px) 넘게 위로 올라가면 "맨 아래로" 버튼을 띄운다 */
export const JUMP_BUTTON_OFFSET_PX = 400;

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
  /** 멘션(@아이디)을 누구로 보일지 찾는 사람들 */
  people: UserProfile[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore(): void;
  onRetry(clientId: string): void;
  emptyText: string;
  /** 커뮤니티 채널이면 프로필 팝업에 그 커뮤니티의 역할을 보여 준다 */
  communityId?: string;
  onReply(message: MessageDto): void;
  /** 전달할 메시지들 (오래된 것부터). 한 개(우클릭 메뉴) 또는 잡은 범위 */
  onForward(messages: MessageDto[]): void;
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
  const [editing, setEditing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // 삭제를 한 번 더 묻는 중인 내 메시지들 (우클릭 메뉴는 하나, 잡기의 D는 여럿)
  const [deleting, setDeleting] = useState<{ messages: MessageDto[]; others: number } | null>(null);
  // 위로 올라가 있을 때: 그때 가장 최신이던 메시지 (그 뒤로 온 메시지 수를 센다)
  const [away, setAway] = useState<{ newestId: string | null } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { socket } = useRealtime();
  // 커뮤니티 소유자·관리자는 남의 메시지도 지울 수 있다 (서버도 같은 규칙, DM은 내 메시지만)
  const myRole = useCommunities().data?.find((c) => c.id === props.communityId)?.myRole;
  const moderator = myRole !== undefined && isManager(myRole);
  const canDelete = (message: MessageDto) => moderator || message.author.id === me.id;
  // 멘션(@아이디)을 이 채널의 사람으로 찾아 닉네임으로 보여 주고, 누르면 정보 팝업
  const { people, communityId } = props;
  const mentionResolver = useMemo<MentionResolver>(() => {
    const byName = new Map([...people, me].map((p) => [p.username.toLowerCase(), p]));
    return {
      find: (username) => byName.get(username),
      meId: me.id,
      onOpen: (user, e) => openProfile(user, e, communityId),
    };
  }, [people, me, communityId]);

  // ── 채팅 영역 잡기 (Ctrl+Shift) ──
  const [range, setRange] = useState<MessageRange | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dragging = useRef(false);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  });
  const selected = useMemo(() => (range ? rangeMessages(messages, range) : []), [messages, range]);
  const selectedIds = useMemo(() => new Set(selected.map((m) => m.id)), [selected]);

  // 휴대폰: 메시지를 오른쪽으로 밀어 답장
  useSwipeToReply(listRef, (id) => {
    const message = messagesRef.current.find((m) => m.id === id);
    if (message) props.onReply(message);
  });

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast((current) => (current === text ? null : current)), 2500);
  };

  // Ctrl과 Shift를 함께 눌렀다 떼면 잡기를 시작한다: 화면 맨 아래에 보이는 메시지 하나부터.
  useEffect(() => {
    const chord = createModifierChord(() => {
      const list = listRef.current;
      // 접혀 있는(inert) 채팅은 잡지 않는다.
      if (!list || list.closest('[inert]')) return;
      const start = bottomVisibleMessage(list) ?? messagesRef.current[0]?.id;
      if (!start) return;
      // 입력창에 있던 포커스를 빼서 D·C·F가 글자로 들어가지 않게 한다.
      (document.activeElement as HTMLElement | null)?.blur?.();
      setRange({ anchor: start, focus: start });
    });
    const down = (e: globalThis.KeyboardEvent) => chord.keydown(e);
    const up = (e: globalThis.KeyboardEvent) => chord.keyup(e);
    const reset = () => chord.reset();
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', reset);
    };
  }, []);

  const deleteSelected = () => {
    const deletable = selected.filter(canDelete);
    if (deletable.length === 0) {
      showToast('잡은 범위에 내가 보낸 메시지가 없습니다.');
      return;
    }
    // 묻는 동안 잡기 키(D, Esc 등)가 함께 먹지 않게 잡기는 끝낸다.
    setRange(null);
    setDeleting({ messages: deletable, others: selected.length - deletable.length });
  };

  /** 지우기 요청. 이 창에서 지운 것으로 적어 두어 알림이 오면 재가 되어 사라지는 연출을 보여 준다 */
  const requestDelete = async (messageId: string) => {
    markOwnDeletion(messageId);
    const error = await request(socket, SocketEvent.MessageDelete, { messageId });
    if (error) forgetOwnDeletion(messageId);
    return error;
  };

  /** 확인 창에서 "삭제"를 누름. 지워진 메시지는 서버 알림(message:deleted)으로 재가 되어 사라진다 */
  const confirmDelete = async (targets: MessageDto[]) => {
    setDeleting(null);
    if (targets.length === 1) {
      setActionError(await requestDelete(targets[0]!.id));
      return;
    }
    let failed = 0;
    let reason: string | null = null;
    for (const message of targets) {
      const error = await requestDelete(message.id);
      if (error) {
        failed++;
        reason = error;
      }
    }
    if (failed > 0) setActionError(`${failed}개를 삭제하지 못했습니다. ${reason ?? ''}`.trim());
    else showToast(`메시지 ${targets.length}개를 삭제했습니다.`);
  };

  const copySelected = () => {
    const count = selected.length;
    setRange(null);
    copyText(transcript(selected)).then(
      () => showToast(`메시지 ${count}개를 복사했습니다.`),
      () => setActionError('복사하지 못했습니다.'),
    );
  };

  const forwardSelected = () => {
    setRange(null);
    props.onForward(selected);
  };

  // 잡는 동안의 키: Shift+↑↓ 늘리기, ↑↓ 옮기기, D 삭제, C 복사, F 전달, Esc 끝내기.
  // 한글 자판에서도 되도록 글자(key) 대신 자리(code)로 본다.
  useEffect(() => {
    if (!range) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setRange(null);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const focus = stepMessage(messages, range.focus, e.key === 'ArrowUp');
        setRange(e.shiftKey ? { ...range, focus } : { anchor: focus, focus });
        listRef.current
          ?.querySelector(`[data-message-id="${focus}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      } else if (e.code === 'KeyD' && !e.ctrlKey && !e.metaKey) {
        deleteSelected();
      } else if (e.code === 'KeyC') {
        copySelected();
      } else if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) {
        forwardSelected();
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // 마우스로 끌어 잡기 (잡기 중일 때). 떼면 끝난다.
  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);
  const selectHandlers = (id: string) => ({
    onMouseDown: (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging.current = true;
      setRange((current) =>
        e.shiftKey && current ? { ...current, focus: id } : { anchor: id, focus: id },
      );
    },
    onMouseEnter: (e: MouseEvent) => {
      if (!dragging.current || (e.buttons & 1) === 0) return;
      setRange((current) => (current ? { ...current, focus: id } : current));
    },
  });

  // column-reverse라 맨 아래가 scrollTop 0이고, 위로 갈수록 음수다.
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const far = Math.abs(e.currentTarget.scrollTop) > JUMP_BUTTON_OFFSET_PX;
    if (far && !away) setAway({ newestId: messages[0]?.id ?? null });
    else if (!far && away) setAway(null);
  };
  const jumpToBottom = () => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  const newIndex = away?.newestId ? messages.findIndex((m) => m.id === away.newestId) : -1;
  const newCount = newIndex > 0 ? newIndex : 0;

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
    <MentionContext.Provider value={mentionResolver}>
      <div className="message-list-wrap">
        {range && (
          <div className="selection-bar" role="status">
            <strong>{selected.length}개 잡음</strong>
            <span>Shift+↑↓ 또는 끌어서 범위</span>
            <span>
              <kbd>D</kbd> {moderator ? '삭제' : '내 메시지 삭제'}
            </span>
            <span>
              <kbd>C</kbd> 복사
            </span>
            <span>
              <kbd>F</kbd> 전달
            </span>
            <button type="button" className="icon-button" onClick={() => setRange(null)}>
              Esc
            </button>
          </div>
        )}
        <div
          className="message-list"
          role="log"
          aria-live="polite"
          ref={listRef}
          onScroll={onScroll}
          data-selecting={range !== null}
        >
          {pending.map((p) => (
            <div key={p.clientId} className="message message--pending" data-status={p.status}>
              <div className="message__gutter" />
              <div className="message__body">
                <p className="message__content">
                  {p.content || <FileCount count={p.attachmentIds.length} />}
                </p>
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
                  mentioned={mentionsMe(message, me)}
                  communityId={props.communityId}
                  onMenu={setMenu}
                  menuOpen={menu?.message.id === message.id}
                  editing={editing === message.id}
                  onEditDone={() => setEditing(null)}
                  selected={selectedIds.has(message.id)}
                  selectProps={range ? selectHandlers(message.id) : undefined}
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
          {actionError && (
            <p className="message-list__error" role="alert">
              {actionError}
              <button
                type="button"
                className="icon-button"
                onClick={() => setActionError(null)}
                aria-label="알림 닫기"
              >
                <X aria-hidden />
              </button>
            </p>
          )}
          {menu && (
            <MessageMenu
              target={menu}
              mine={menu.message.author.id === me.id}
              canDelete={canDelete(menu.message)}
              onReply={props.onReply}
              onForward={(message) => props.onForward([message])}
              onEdit={(message) => setEditing(message.id)}
              onDelete={(message) => setDeleting({ messages: [message], others: 0 })}
              onClose={() => setMenu(null)}
            />
          )}
        </div>
        {deleting && (
          <DeleteConfirm
            {...deleting}
            onConfirm={() => void confirmDelete(deleting.messages)}
            onCancel={() => setDeleting(null)}
          />
        )}
        {toast && (
          <p className="message-list__toast" role="status">
            {toast}
          </p>
        )}
        {away && (
          <button
            type="button"
            className="jump-to-bottom"
            onClick={jumpToBottom}
            aria-label={newCount > 0 ? `새 메시지 ${newCount}개, 맨 아래로` : '맨 아래로'}
            title="맨 아래로"
          >
            <ArrowDown aria-hidden />
            {newCount > 0 && (
              <span className="jump-to-bottom__count" aria-hidden>
                {newCount > 99 ? '99+' : newCount}
              </span>
            )}
          </button>
        )}
      </div>
    </MentionContext.Provider>
  );
}

/** 미리보기에 보여 줄 글 길이 */
const DELETE_PREVIEW_CHARS = 120;

/** 메시지 삭제를 한 번 더 묻는 창. 하나면 그 메시지를 미리 보여 준다 */
function DeleteConfirm({
  messages,
  others,
  onConfirm,
  onCancel,
}: {
  messages: MessageDto[];
  others: number;
  onConfirm(): void;
  onCancel(): void;
}) {
  const single = messages.length === 1 ? messages[0]! : null;
  const text = single ? markdownToPlain(single.content) : '';
  const preview = Array.from(text).slice(0, DELETE_PREVIEW_CHARS).join('');
  return (
    <ConfirmDialog
      title={single ? '메시지를 삭제할까요?' : `메시지 ${messages.length}개를 삭제할까요?`}
      confirmLabel="삭제"
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {single && (
        <div className="delete-preview">
          <Avatar user={single.author} size={32} />
          <div className="delete-preview__body">
            <div className="delete-preview__head">
              <strong>{displayName(single.author)}</strong>
              <time dateTime={single.createdAt}>{formatTime(single.createdAt)}</time>
            </div>
            {preview && (
              <p className="delete-preview__text">
                {preview}
                {preview.length < text.length && '…'}
              </p>
            )}
            {single.attachments.length > 0 && (
              <span className="delete-preview__files">
                <FileCount count={single.attachments.length} />
              </span>
            )}
          </div>
        </div>
      )}
      {others > 0 && <p>다른 사람의 메시지 {others}개는 그대로 둡니다.</p>}
      <p>첨부 파일도 함께 지워지고 되돌릴 수 없습니다.</p>
    </ConfirmDialog>
  );
}

/** 메시지 수정·삭제 요청. 실패하면 알릴 문구, 성공하면 null (목록은 서버의 알림으로 바뀐다) */
async function request<E extends typeof SocketEvent.MessageEdit | typeof SocketEvent.MessageDelete>(
  socket: AppSocket | null,
  event: E,
  payload: E extends typeof SocketEvent.MessageEdit
    ? { messageId: string; content: string }
    : { messageId: string },
): Promise<string | null> {
  if (!socket?.connected) return '서버에 연결되어 있지 않습니다.';
  try {
    const ack = (await socket
      .timeout(10_000)
      // 이벤트마다 ack 타입이 달라서 여기서는 공통 모양으로 받는다.
      .emitWithAck(
        event as typeof SocketEvent.MessageDelete,
        payload as { messageId: string },
      )) as SocketAck<unknown>;
    return ack.ok ? null : ack.error;
  } catch {
    return '서버가 응답하지 않습니다.';
  }
}

function MessageItem({
  message,
  grouped,
  mine,
  mentioned,
  communityId,
  onMenu,
  menuOpen,
  editing,
  onEditDone,
  selected,
  selectProps,
}: {
  message: MessageDto;
  grouped: boolean;
  mine: boolean;
  /** 나를 부른 메시지 (@내아이디, 내 메시지에 답장): 강조해서 보인다 */
  mentioned: boolean;
  communityId?: string;
  onMenu(target: MenuTarget): void;
  /** 이 메시지의 메뉴가 떠 있는지 (손가락으로 쓰는 기기에서 밝게 보여 준다) */
  menuOpen: boolean;
  editing: boolean;
  onEditDone(): void;
  /** 채팅 영역 잡기로 잡혔는지 */
  selected: boolean;
  /** 잡기 중일 때만: 눌러서 잡기 시작, 끌어서 늘리기 */
  selectProps?: { onMouseDown(e: MouseEvent): void; onMouseEnter(e: MouseEvent): void };
}) {
  const [avatarHovered, setAvatarHovered] = useState(false);
  const showProfile = (e: MouseEvent) => openProfile(message.author, e, communityId);
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    // 이 메시지의 글을 골라 둔 상태면 브라우저 기본 메뉴(복사 등)를 그대로 쓴다. 다른 곳에 남은
    // 선택은 보지 않는다 (예전엔 남은 선택 때문에 메뉴가 뜨지 않아 삭제할 수 없었다).
    const selection = window.getSelection();
    if (
      selection?.toString() &&
      selection.anchorNode &&
      e.currentTarget.contains(selection.anchorNode)
    ) {
      return;
    }
    e.preventDefault();
    const link = (e.target as HTMLElement).closest('a')?.href ?? null;
    onMenu({ message, x: e.clientX, y: e.clientY, link });
  };

  return (
    <article
      className="message"
      data-grouped={grouped && !message.replyTo}
      data-mine={mine}
      data-mentioned={mentioned || undefined}
      data-message-id={message.id}
      data-selected={selected}
      data-menu-open={menuOpen || undefined}
      onContextMenu={onContextMenu}
      {...selectProps}
    >
      {/* 손가락으로 오른쪽으로 밀 때 왼쪽에 나오는 답장 표시 (swipeReply.ts) */}
      <span className="message__swipe-reply" aria-hidden>
        <Reply />
      </span>
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
            onMouseEnter={() => setAvatarHovered(true)}
            onMouseLeave={() => setAvatarHovered(false)}
            aria-label={`${displayName(message.author)} 정보`}
          >
            <Avatar user={message.author} size={36} animate={avatarHovered} />
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
        {message.forwarded && (
          <p className="message__forwarded">
            <Forward aria-hidden /> 전달된 메시지
          </p>
        )}
        {editing ? (
          <MessageEditor message={message} onDone={onEditDone} />
        ) : (
          message.content && (
            <div className="message__content">
              <Markdown
                text={message.content}
                suffix={
                  message.editedAt && (
                    <span className="message__edited" title={formatTime(message.editedAt)}>
                      (수정됨)
                    </span>
                  )
                }
              />
            </div>
          )
        )}
        <MessageAttachments attachments={message.attachments} />
      </div>
    </article>
  );
}

/**
 * 내가 보낸 메시지 고치기: Enter 저장, Shift+Enter 줄바꿈, Esc 취소 (한글 조합 중 Enter는 무시).
 * 손가락으로 쓰는 기기와 휴대폰 화면에서는 Enter가 줄바꿈이고 저장 버튼으로 저장한다. 휴대폰 화면도 보는 이유:
 * 손가락 기기인지(pointer: coarse)만 보면, 그렇게 알리지 않는 환경(마우스·펜을 알리는 휴대폰, 개발자 도구의
 * 휴대폰 크기 보기)에서 줄을 바꾸려던 Enter가 바로 저장해 버렸다.
 */
function MessageEditor({ message, onDone }: { message: MessageDto; onDone(): void }) {
  const { socket } = useRealtime();
  const [text, setText] = useState(message.content);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const [touch] = useState(() => isTouchDevice() || window.matchMedia(PHONE_QUERY).matches);

  // 열면 커서를 글 끝에 둔다 (이어서 고치기 쉽게).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const save = async () => {
    const content = text.trim();
    if (content === message.content) return onDone();
    setBusy(true);
    const failed = await request(socket, SocketEvent.MessageEdit, {
      messageId: message.id,
      content,
    });
    setBusy(false);
    if (failed) setError(failed);
    else onDone();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onDone();
    } else if (e.key === 'Enter' && !e.shiftKey && !touch) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div className="message__editor">
      <textarea
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        maxLength={MESSAGE_MAX_LENGTH}
        rows={Math.min(8, text.split('\n').length + 1)}
        disabled={busy}
        aria-label="메시지 고치기"
      />
      <p className="form__hint">
        {!touch && 'Enter 저장 · Esc 취소'}
        <button type="button" className="message__editor-action" onClick={onDone}>
          취소
        </button>
        <button type="button" className="message__editor-action" onClick={() => void save()}>
          저장
        </button>
      </p>
      {error && <p className="form__error">{error}</p>}
    </div>
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
      <Reply aria-hidden />
      <strong>{displayName(reply.author)}</strong>
      <span className="message__reply-text">
        {reply.content ? (
          markdownToPlain(reply.content)
        ) : reply.attachmentCount > 0 ? (
          <FileCount count={reply.attachmentCount} />
        ) : (
          ''
        )}
      </span>
    </button>
  );
}

/** 목록에서 화면에 보이는 가장 아래(최신) 메시지. 잡기를 여기서 시작한다 (스크롤을 올려 둔 곳에서 바로 잡게) */
function bottomVisibleMessage(list: HTMLElement): string | null {
  const view = list.getBoundingClientRect();
  // column-reverse라 DOM 순서가 최신부터다.
  for (const el of list.querySelectorAll<HTMLElement>('[data-message-id]')) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= view.bottom + 1 && rect.top >= view.top - 1) return el.dataset.messageId!;
  }
  return null;
}
