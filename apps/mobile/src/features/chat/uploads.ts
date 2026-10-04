import {
  type AttachmentDto,
  DEFAULT_UPLOAD_MAX_SIZE_MB,
  MAX_ATTACHMENTS_PER_MESSAGE,
  type UploadTicket,
  isBlockedFileName,
} from '@metacode/shared';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch, apiSend } from '../../api/client';

/** 고른 파일 하나 (사진 고르기·파일 고르기 결과를 같은 모양으로) */
export interface PickedFile {
  uri: string;
  name: string;
  size: number;
  /** 이미지면 올리는 동안 미리보기 */
  isImage: boolean;
}

export interface AttachmentDraft {
  localId: string;
  file: PickedFile;
  progress: number;
  status: 'uploading' | 'ready' | 'failed';
  error?: string;
  /** 올릴 주소를 받은 뒤 생기는 서버 기록 ID (빼면 서버에서도 지운다) */
  serverId?: string;
  attachment?: AttachmentDto;
}

const MAX_BYTES = DEFAULT_UPLOAD_MAX_SIZE_MB * 1024 * 1024;

/** 사진 고르기 (여러 장). 고르지 않으면 빈 목록 */
export async function pickImages(): Promise<PickedFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: MAX_ATTACHMENTS_PER_MESSAGE,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.map((a) => ({
    uri: a.uri,
    name: a.fileName ?? `image-${Date.now()}.jpg`,
    size: a.fileSize ?? new File(a.uri).size,
    isImage: true,
  }));
}

/** 파일 고르기 (여러 개). 앱 캐시로 복사해 file:// 주소로 받는다 (content:// 는 올리기 어려움) */
export async function pickFiles(): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  return result.assets.map((a) => ({
    uri: a.uri,
    name: a.name,
    size: a.size ?? new File(a.uri).size,
    isImage: a.mimeType?.startsWith('image/') ?? false,
  }));
}

/**
 * 입력창에 붙인 첨부들 (웹 features/chat/uploads.ts와 같은 흐름).
 * `POST /uploads`(크기를 서명에 넣은 주소) → 저장소에 직접 PUT(진행률) → `POST /uploads/:id/complete`.
 * 고르는 즉시 올리기 시작해서, 글을 쓰는 동안 업로드가 끝나게 한다.
 */
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
        const ticket = await apiSend<UploadTicket>('/uploads', 'POST', {
          channelId,
          fileName: draft.file.name,
          size: draft.file.size,
        });
        if (controller.signal.aborted) return;
        update(draft.localId, { serverId: ticket.attachmentId });
        const task = new File(draft.file.uri).createUploadTask(ticket.uploadUrl, {
          httpMethod: 'PUT',
          headers: ticket.headers,
          signal: controller.signal,
          onProgress: ({ bytesSent, totalBytes }) =>
            totalBytes > 0 && update(draft.localId, { progress: bytesSent / totalBytes }),
        });
        const result = await task.uploadAsync();
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`업로드하지 못했습니다 (${result.status}).`);
        }
        const attachment = await apiFetch<AttachmentDto>(
          `/uploads/${ticket.attachmentId}/complete`,
          { method: 'POST' },
        );
        update(draft.localId, { status: 'ready', progress: 1, attachment });
      } catch (error) {
        if (controller.signal.aborted) return;
        const message =
          error instanceof ApiError || error instanceof Error
            ? error.message
            : '업로드하지 못했습니다.';
        update(draft.localId, { status: 'failed', error: message });
      } finally {
        controllers.current.delete(draft.localId);
      }
    },
    [channelId],
  );

  const add = useCallback(
    (files: PickedFile[]) => {
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
        localId: Crypto.randomUUID(),
        file,
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
    if (draft.serverId) {
      void apiFetch(`/uploads/${draft.serverId}`, { method: 'DELETE' }).catch(() => undefined);
    }
    setDrafts((list) => list.filter((d) => d.localId !== localId));
  }, []);

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

  /** 보낸 뒤: 서버 기록은 메시지에 붙었으니 화면 상태만 비운다 */
  const clear = useCallback(() => {
    setDrafts([]);
    setNotice(null);
  }, []);

  // 채널을 떠나면 올리던 것을 멈춘다
  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active.values()) controller.abort();
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
