import {
  type AttachmentLink,
  type AttachmentDto,
  DEFAULT_UPLOAD_MAX_SIZE_MB,
  MAX_ATTACHMENTS_PER_MESSAGE,
  type UploadTicket,
  attachmentPath,
  isBlockedFileName,
} from '@metacode/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import { jsonBody } from '../../api/queries';
import { API_URL } from '../../config';
import { getDesktopBridge, isAndroidApp, loadAndroid } from '../../platform';

/** 저장소에 직접 PUT한다. fetch는 업로드 진행률을 알려 주지 않아 XHR을 쓴다. */
function putFile(
  ticket: UploadTicket,
  file: File,
  onProgress: (ratio: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.uploadUrl);
    for (const [name, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`업로드하지 못했습니다 (${xhr.status}).`));
    xhr.onerror = () => reject(new Error('업로드 중 연결이 끊겼습니다.'));
    xhr.onabort = () => reject(new DOMException('취소됨', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

export interface AttachmentDraft {
  localId: string;
  file: File;
  /** 이미지면 올리는 동안 보여 줄 미리보기 (object URL) */
  previewUrl: string | null;
  progress: number;
  status: 'uploading' | 'ready' | 'failed';
  error?: string;
  /** 올릴 주소를 받은 뒤 생기는 서버 기록 ID (빼면 서버에서도 지운다) */
  serverId?: string;
  /** 업로드 확인이 끝난 첨부 */
  attachment?: AttachmentDto;
}

const MAX_BYTES = DEFAULT_UPLOAD_MAX_SIZE_MB * 1024 * 1024;

/** 입력창에 붙인 첨부들. 고르는 즉시 올리기 시작해서, 글을 쓰는 동안 업로드가 끝나게 한다. */
export function useAttachmentDrafts(channelId: string) {
  const [drafts, setDrafts] = useState<AttachmentDraft[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const update = (localId: string, patch: Partial<AttachmentDraft>) =>
    setDrafts((list) => list.map((d) => (d.localId === localId ? { ...d, ...patch } : d)));

  const start = useCallback(
    async (draft: AttachmentDraft) => {
      const controller = new AbortController();
      controllers.current.set(draft.localId, controller);
      try {
        const ticket = await apiFetch<UploadTicket>('/uploads', {
          method: 'POST',
          ...jsonBody({ channelId, fileName: draft.file.name, size: draft.file.size }),
          signal: controller.signal,
        });
        update(draft.localId, { serverId: ticket.attachmentId });
        await putFile(
          ticket,
          draft.file,
          (progress) => update(draft.localId, { progress }),
          controller.signal,
        );
        const attachment = await apiFetch<AttachmentDto>(
          `/uploads/${ticket.attachmentId}/complete`,
          {
            method: 'POST',
            signal: controller.signal,
          },
        );
        update(draft.localId, { status: 'ready', progress: 1, attachment });
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        // fetch의 네트워크 오류는 영어 메시지(TypeError)라 알아보기 쉽게 바꾼다.
        const message =
          error instanceof TypeError ? '서버에 연결하지 못했습니다.' : (error as Error).message;
        update(draft.localId, { status: 'failed', error: message });
      } finally {
        controllers.current.delete(draft.localId);
      }
    },
    [channelId],
  );

  const add = useCallback(
    (files: File[]) => {
      const room = MAX_ATTACHMENTS_PER_MESSAGE - draftsRef.current.length;
      const problems: string[] = [];
      if (files.length > room)
        problems.push(`한 번에 ${MAX_ATTACHMENTS_PER_MESSAGE}개까지 보낼 수 있습니다.`);
      const accepted = files.slice(0, Math.max(room, 0)).filter((file) => {
        if (isBlockedFileName(file.name)) {
          problems.push(`${file.name}: 실행 파일은 올릴 수 없습니다.`);
          return false;
        }
        if (file.size === 0) {
          problems.push(`${file.name}: 빈 파일입니다.`);
          return false;
        }
        if (file.size > MAX_BYTES) {
          problems.push(`${file.name}: ${DEFAULT_UPLOAD_MAX_SIZE_MB}MB를 넘습니다.`);
          return false;
        }
        return true;
      });
      setNotice(problems.length > 0 ? problems.join(' ') : null);
      const created = accepted.map<AttachmentDraft>((file) => ({
        localId: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        progress: 0,
        status: 'uploading',
      }));
      setDrafts((list) => [...list, ...created]);
      for (const draft of created) void start(draft);
    },
    [start],
  );

  const remove = useCallback((localId: string) => {
    const draft = draftsRef.current.find((d) => d.localId === localId);
    if (!draft) return;
    controllers.current.get(localId)?.abort();
    if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    // 서버에 기록이 생겼으면 지운다 (업로드 중에 뺀 경우도 포함).
    if (draft.serverId) {
      void apiFetch(`/uploads/${draft.serverId}`, { method: 'DELETE' }).catch(() => undefined);
    }
    setDrafts((list) => list.filter((d) => d.localId !== localId));
  }, []);

  /** 실패한 첨부를 처음부터 다시 올린다. */
  const retry = useCallback(
    (localId: string) => {
      const draft = draftsRef.current.find((d) => d.localId === localId);
      if (!draft || draft.status !== 'failed') return;
      if (draft.serverId) {
        void apiFetch(`/uploads/${draft.serverId}`, { method: 'DELETE' }).catch(() => undefined);
      }
      const fresh: AttachmentDraft = {
        ...draft,
        status: 'uploading',
        progress: 0,
        error: undefined,
        serverId: undefined,
      };
      update(localId, fresh);
      void start(fresh);
    },
    [start],
  );

  /** 보낸 뒤: 서버 기록은 메시지에 붙었으니 화면 상태만 비운다. */
  const clear = useCallback(() => {
    for (const draft of draftsRef.current)
      if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    setDrafts([]);
    setNotice(null);
  }, []);

  // 채널을 떠나면 올리던 것을 멈추고 미리보기 메모리를 돌려준다.
  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active.values()) controller.abort();
      for (const draft of draftsRef.current)
        if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    };
  }, []);

  return {
    drafts,
    notice,
    add,
    remove,
    retry,
    clear,
    uploading: drafts.some((d) => d.status === 'uploading'),
    readyAttachments: drafts.flatMap((d) =>
      d.status === 'ready' && d.attachment ? [d.attachment] : [],
    ),
  };
}

export const attachmentUrl = (id: string, options?: Parameters<typeof attachmentPath>[1]) =>
  `${API_URL}${attachmentPath(id, options)}`;

/**
 * 파일 받기. 웹은 쿠키로 인증되는 주소로 이동하면 서버가 저장소로 보내 주고 다운로드가 시작된다
 * (페이지는 그대로). 데스크톱은 메인 프로세스가 인증 헤더를 붙여 내려받는다.
 */
export function downloadAttachment(attachment: AttachmentDto): void {
  const url = attachmentUrl(attachment.id, { download: true });
  const desktop = getDesktopBridge();
  if (desktop) {
    void desktop.download(url);
    return;
  }
  // 안드로이드 앱의 창은 파일을 받지 못하므로, 권한을 확인한 저장소 주소를 받아 시스템 브라우저로 연다.
  if (isAndroidApp()) {
    void (async () => {
      const link = await apiFetch<AttachmentLink>(
        `/attachments/${attachment.id}/link?download=1`,
      ).catch(() => null);
      if (link) await (await loadAndroid()).openExternal(link.url);
    })();
    return;
  }
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
