import type { VoiceMember } from '@metacode/shared';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { displayName } from '../../ui/format';
import { useVoiceStore } from './store';
import { useVoice } from './VoiceProvider';

/** 마우스를 올리고 이만큼 머물러야 미리보기를 연다 (지나가기만 해도 구독하지 않게) */
const OPEN_DELAY_MS = 300;
const WIDTH = 320;
const MARGIN = 8;

/**
 * 화면 공유 미리보기: 공유 중인 참여자 위에 마우스를 올리면 오른쪽에 작게 띄운다.
 * 같은 통화에 있으면 그 사람의 화면 영상만 잠깐 받고(소리는 받지 않음), 없으면 들어가라고 안내한다.
 * 항목에 hoverProps를 펼쳐 넣고, popup을 함께 그린다.
 */
export function useSharePreview(channelId: string, member: VoiceMember) {
  const voice = useVoice();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const userId = member.user.id;

  const close = () => {
    clearTimeout(timer.current);
    if (!anchor) return;
    setAnchor(null);
    if (useVoiceStore.getState().previewing === userId) voice.preview(null);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  const hoverProps = {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      if (!member.sharing) return;
      const rect = e.currentTarget.getBoundingClientRect();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setAnchor(rect);
        if (useVoiceStore.getState().session?.channelId === channelId) voice.preview(userId);
      }, OPEN_DELAY_MS);
    },
    onMouseLeave: close,
  };

  // 공유가 끝나면 보이지 않는다 (마우스를 떼면 미리보기 구독도 정리된다).
  const popup =
    anchor && member.sharing ? (
      <PreviewPopup channelId={channelId} member={member} anchor={anchor} />
    ) : null;
  return { hoverProps, popup };
}

function PreviewPopup({
  channelId,
  member,
  anchor,
}: {
  channelId: string;
  member: VoiceMember;
  anchor: DOMRect;
}) {
  const inCall = useVoiceStore((s) => s.session?.channelId === channelId);
  const stream = useVoiceStore((s) => (s.previewing === member.user.id ? s.previewScreen : null));
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  // 오른쪽에 띄우되, 자리가 없으면 왼쪽에 띄운다.
  const right = anchor.right + MARGIN;
  const left = right + WIDTH > window.innerWidth ? anchor.left - WIDTH - MARGIN : right;
  const top = Math.max(MARGIN, Math.min(anchor.top - 40, window.innerHeight - 240));

  return (
    <div
      className="share-preview"
      style={{ left: Math.max(MARGIN, left), top, width: WIDTH }}
      role="tooltip"
    >
      <p className="share-preview__title">
        <span className="screen-viewer__live">LIVE</span> {displayName(member.user)}의 화면
      </p>
      <div className="share-preview__stage">
        {inCall ? (
          <>
            <video ref={videoRef} autoPlay playsInline muted hidden={!stream} />
            {!stream && <span>화면을 불러오는 중…</span>}
          </>
        ) : (
          <span>통화에 들어가면 미리 볼 수 있습니다. LIVE를 누르면 들어가서 봅니다.</span>
        )}
      </div>
    </div>
  );
}
