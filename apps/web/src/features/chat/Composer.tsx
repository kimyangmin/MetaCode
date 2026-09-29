import { MESSAGE_MAX_LENGTH, type MessageDto } from '@metacode/shared';
import { displayName } from '../../ui/format';
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { type AttachmentDraft, formatBytes } from './uploads';
import { File as FileIcon, Paperclip, Reply, SendHorizontal, X } from 'lucide-react';
import { FileCount } from '../../ui/icons';
import { RETURN_FOCUS_ATTR, returnPanelFocus } from '../../layout/panelFocus';
import { isTouchDevice } from '../../ui/useMediaQuery';

const MAX_HEIGHT_PX = 200;

interface ComposerProps {
  placeholder: string;
  drafts: AttachmentDraft[];
  notice: string | null;
  /** 첨부가 아직 올라가는 중이면 보내지 않는다 */
  uploading: boolean;
  /** 확인이 끝난 첨부가 있으면 글 없이도 보낼 수 있다 */
  hasReadyAttachments: boolean;
  onSend(content: string): void;
  onTyping(): void;
  onAddFiles(files: File[]): void;
  onRemoveDraft(localId: string): void;
  onRetryDraft(localId: string): void;
  /** 답장하는 중이면 원래 메시지 (입력창 위에 표시) */
  replyTo: MessageDto | null;
  onCancelReply(): void;
}

/**
 * 메시지 입력창. Enter로 보내고 Shift+Enter로 줄을 바꾼다 (손가락으로 쓰는 기기는 Enter가 줄 바꾸기).
 * 한글 입력 중(IME 조합 중)의 Enter는 글자 확정이므로 보내지 않는다.
 * 파일은 📎 버튼, 붙여넣기(스크린샷 등), 채팅 영역에 끌어 놓기로 붙인다.
 */
export function Composer(props: ComposerProps) {
  const { placeholder, drafts, uploading, hasReadyAttachments, onSend, onTyping, onAddFiles } =
    props;
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // 내용에 맞춰 높이를 늘리되 너무 커지지 않게 한다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    // box-sizing: border-box라 높이에 테두리도 들어간다. scrollHeight만 쓰면 테두리만큼 모자라
    // 한 줄에서도 넘침(스크롤)이 생긴다.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight + border, MAX_HEIGHT_PX)}px`;
  }, [value]);

  // 첨부를 붙이면(📎 버튼, 끌어 놓기, 붙여넣기) 입력창으로 돌아온다. 📎 버튼에 포커스가 남아 있으면
  // Enter가 보내기 대신 파일 선택 창을 다시 연다.
  const draftCount = drafts.length;
  const previousDraftCount = useRef(draftCount);
  useEffect(() => {
    if (draftCount > previousDraftCount.current) ref.current?.focus();
    previousDraftCount.current = draftCount;
  }, [draftCount]);

  // 답장을 누르면 바로 쓸 수 있게 입력창으로 간다.
  const replyId = props.replyTo?.id;
  useEffect(() => {
    if (replyId) ref.current?.focus();
  }, [replyId]);

  const canSend = !uploading && (value.trim().length > 0 || hasReadyAttachments);

  const submit = () => {
    const content = value.trim();
    if (uploading || (!content && !hasReadyAttachments)) return;
    onSend(content);
    setValue('');
    // 광장에서 /로 왔으면 보낸 뒤 광장으로 돌아간다 (계속 걸으며 말하기).
    returnPanelFocus(ref.current);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && props.replyTo) {
      props.onCancelReply();
      return;
    }
    if (e.key === 'Escape' && returnPanelFocus(ref.current)) {
      e.preventDefault();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // 휴대폰·태블릿의 화면 자판에서는 Enter가 줄 바꾸기이고, 보내기 버튼으로 보낸다.
    if (isTouchDevice()) return;
    e.preventDefault();
    submit();
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length === 0) return;
    e.preventDefault();
    onAddFiles(files);
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {drafts.length > 0 && (
        <ul className="drafts" aria-label="첨부할 파일">
          {drafts.map((draft) => (
            <DraftChip
              key={draft.localId}
              draft={draft}
              onRemove={props.onRemoveDraft}
              onRetry={props.onRetryDraft}
            />
          ))}
        </ul>
      )}
      {props.replyTo && (
        <div className="composer__reply">
          <span>
            <Reply aria-hidden /> <strong>{displayName(props.replyTo.author)}</strong>님에게 답장
          </span>
          <span className="composer__reply-text">
            {props.replyTo.content || <FileCount count={props.replyTo.attachments.length} />}
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={props.onCancelReply}
            aria-label="답장 취소"
            title="답장 취소 (Esc)"
          >
            <X aria-hidden />
          </button>
        </div>
      )}
      {props.notice && (
        <p className="composer__notice" role="alert">
          {props.notice}
        </p>
      )}
      <div className="composer__row">
        <button
          type="button"
          className="icon-button composer__attach"
          onClick={() => fileInput.current?.click()}
          aria-label="파일 첨부"
          title="파일 첨부"
        >
          <Paperclip aria-hidden />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            onAddFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <textarea
          ref={ref}
          className="composer__input"
          value={value}
          placeholder={placeholder}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          onChange={(e) => {
            setValue(e.target.value);
            if (e.target.value.trim()) onTyping();
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          // 다른 곳으로 포커스가 나가면 "보내면 광장으로" 약속을 지운다.
          onBlur={(e) => e.currentTarget.removeAttribute(RETURN_FOCUS_ATTR)}
          aria-label={placeholder}
        />
        <button
          type="submit"
          className="icon-button composer__send"
          disabled={!canSend}
          aria-label="보내기"
          title="보내기 (Enter)"
        >
          <SendHorizontal aria-hidden />
        </button>
      </div>
    </form>
  );
}

function DraftChip({
  draft,
  onRemove,
  onRetry,
}: {
  draft: AttachmentDraft;
  onRemove(localId: string): void;
  onRetry(localId: string): void;
}) {
  return (
    <li className="draft" data-status={draft.status} title={draft.error ?? draft.file.name}>
      {draft.previewUrl ? (
        <img className="draft__preview" src={draft.previewUrl} alt="" />
      ) : (
        <span className="draft__icon" aria-hidden>
          <FileIcon />
        </span>
      )}
      <span className="draft__info">
        <span className="draft__name">{draft.file.name}</span>
        <span className="draft__meta">
          {draft.status === 'failed' ? (
            <button type="button" className="draft__retry" onClick={() => onRetry(draft.localId)}>
              {draft.error ?? '실패'} · 다시 시도
            </button>
          ) : draft.status === 'uploading' ? (
            `${Math.round(draft.progress * 100)}%`
          ) : (
            formatBytes(draft.file.size)
          )}
        </span>
      </span>
      {draft.status === 'uploading' && (
        <span className="draft__progress" style={{ width: `${draft.progress * 100}%` }} />
      )}
      <button
        type="button"
        className="draft__remove"
        onClick={() => onRemove(draft.localId)}
        aria-label={`${draft.file.name} 빼기`}
      >
        <X aria-hidden />
      </button>
    </li>
  );
}
