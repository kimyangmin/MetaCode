import type { AttachmentDto, AttachmentLink } from '@metacode/shared';
import { useQuery } from '@tanstack/react-query';
import { Linking } from 'react-native';
import { apiFetch } from '../../api/client';

/** 저장소 주소는 10분 유효하다. 그보다 조금 일찍 새로 받는다 */
const LINK_STALE_MS = 8 * 60 * 1000;

/**
 * 첨부를 보여 줄 저장소 주소. 앱은 쿠키가 없고 `<Image>`가 받는 302 뒤 요청에 인증 헤더가 따라가면 저장소가
 * 거절하므로(서명 주소와 Authorization을 함께 받지 않음), 권한을 확인한 주소를 먼저 받아 그대로 쓴다
 * (`GET /attachments/:id/link`, 예전 Capacitor 앱의 받기와 같은 경로).
 */
export function useAttachmentLink(id: string, variant: 'original' | 'thumbnail') {
  return useQuery({
    queryKey: ['attachment-link', id, variant],
    queryFn: () =>
      apiFetch<AttachmentLink>(
        `/attachments/${id}/link${variant === 'thumbnail' ? '?variant=thumbnail' : ''}`,
      ),
    staleTime: LINK_STALE_MS,
    gcTime: LINK_STALE_MS,
  });
}

/** 파일 받기: 권한을 확인한 주소를 시스템 브라우저(다운로드 관리자)로 연다 */
export async function openAttachment(attachment: AttachmentDto): Promise<void> {
  const link = await apiFetch<AttachmentLink>(`/attachments/${attachment.id}/link?download=1`);
  await Linking.openURL(link.url);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
