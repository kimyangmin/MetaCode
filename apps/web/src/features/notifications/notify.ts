import type { CommunitySummary, DmSummary, MessageDto, UserProfile } from '@metacode/shared';
import { displayName, dmTitle, markdownToPlain, mentionsMe } from '@metacode/client';
import { type NotifyLevel, useNotificationSettings } from './settings';
import { playNotificationSound } from './sound';

// 나를 부른 메시지인지는 네이티브 앱과 함께 쓴다 (packages/client)
export { mentionsMe } from '@metacode/client';

/**
 * 이 메시지를 알릴지. 내가 보낸 것은 알리지 않고, 지금 그 채널을 보고 있으면(창이 앞에 있을 때) 알리지 않는다.
 * DM은 "DM과 멘션"에서도 늘 알린다.
 */
export function shouldNotify(input: {
  level: NotifyLevel;
  message: Pick<MessageDto, 'author' | 'content' | 'replyTo' | 'channelId'>;
  me: Pick<UserProfile, 'id' | 'username'>;
  isDm: boolean;
  viewing: boolean;
}): boolean {
  const { level, message, me, isDm, viewing } = input;
  if (level === 'off' || message.author.id === me.id || viewing) return false;
  if (level === 'all') return true;
  return isDm || mentionsMe(message, me);
}

// ── 지금 보고 있는 채널 ──

let viewingChannel: string | null = null;

/** 채팅 화면이 지금 보여 주는 채널 (ChatView가 정한다) */
export function setViewingChannel(channelId: string | null): void {
  viewingChannel = channelId;
  // 그 채널을 열면 그 채널의 알림은 알림 센터에서 걷는다 (이미 읽었으므로)
  if (channelId) {
    for (const shown of shownByChannel.get(channelId) ?? []) shown.close();
    shownByChannel.delete(channelId);
  }
}

/** 띄운 시스템 알림 (채널 → 알림들) */
const shownByChannel = new Map<string, Notification[]>();

function isViewing(channelId: string): boolean {
  return (
    viewingChannel === channelId && document.visibilityState === 'visible' && document.hasFocus()
  );
}

// ── 알림 창을 누르면 그 채널로 ──

let navigator_: ((path: string) => void) | null = null;

/** 알림을 눌렀을 때 화면을 옮길 함수 (라우터가 있는 AppLayout이 정한다) */
export function setNotificationNavigator(navigate: ((path: string) => void) | null): void {
  navigator_ = navigate;
}

/** 같은 메시지를 여러 탭이 한꺼번에 알리지 않게, 알린 메시지를 기억한다 */
const NOTIFIED_KEY = 'metacode:notified';

function claimMessage(id: string): boolean {
  try {
    const recent = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '[]') as string[];
    if (recent.includes(id)) return false;
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify([id, ...recent].slice(0, 30)));
  } catch {
    // 기억하지 못하면 그냥 알린다.
  }
  return true;
}

/** 분리한 창·에디터 창(/popout/)은 알리지 않는다 (메인 창과 함께 울리지 않게) */
function isPopoutWindow(): boolean {
  return `${location.pathname}${location.hash}`.includes('/popout/');
}

/** 알림 본문: 마크다운 기호를 뺀 글, 첨부만 있으면 그 수 */
function bodyOf(message: MessageDto): string {
  const text = markdownToPlain(message.content).replace(/\s+/g, ' ').trim();
  if (text) return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  const images = message.attachments.filter((a) => a.kind === 'image').length;
  return images === message.attachments.length
    ? `사진 ${images}장`
    : `파일 ${message.attachments.length}개`;
}

/**
 * 새 메시지가 왔을 때(실시간 연결) 설정대로 알림음을 틀고 시스템 알림을 띄운다.
 * 채널 이름은 쿼리 캐시의 커뮤니티·DM 목록에서 찾는다.
 */
export function notifyMessage(input: {
  message: MessageDto;
  me: UserProfile | undefined;
  communities: CommunitySummary[] | undefined;
  dms: DmSummary[] | undefined;
}): void {
  const { message, me, communities, dms } = input;
  if (!me || isPopoutWindow()) return;
  const settings = useNotificationSettings.getState();
  const dm = dms?.find((d) => d.id === message.channelId);
  const community = communities?.find((c) => c.channels.some((ch) => ch.id === message.channelId));
  if (!dm && !community) return;
  const notify = shouldNotify({
    level: settings.level,
    message,
    me,
    isDm: !!dm,
    viewing: isViewing(message.channelId),
  });
  if (!notify || !claimMessage(message.id)) return;

  if (settings.sound) playNotificationSound(settings.volume);
  if (!settings.desktop || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;

  const channel = community?.channels.find((ch) => ch.id === message.channelId);
  const title = dm
    ? dm.type === 'GROUP_DM'
      ? `${displayName(message.author)} (${dmTitle(dm, me.id)})`
      : displayName(message.author)
    : `${displayName(message.author)} (#${channel?.name ?? ''}, ${community!.name})`;
  const path = dm ? `/dm/${dm.id}` : `/c/${community!.id}/${message.channelId}`;
  try {
    // 태그는 메시지마다 따로 준다: 같은 태그(예전엔 채널 ID)의 알림이 알림 센터에 남아 있으면 브라우저가
    // 새 알림을 띄우지 않고 그 알림의 내용만 조용히 바꿔서, 같은 채널의 두 번째 알림부터 보이지 않았다.
    const shown = new Notification(title, {
      body: bodyOf(message),
      icon: message.author.avatarUrl,
      tag: message.id,
      // 소리는 앱이 틀므로 시스템 소리는 끈다
      silent: true,
    });
    const list = shownByChannel.get(message.channelId) ?? [];
    list.push(shown);
    shownByChannel.set(message.channelId, list);
    shown.onclose = () => {
      const left = (shownByChannel.get(message.channelId) ?? []).filter((n) => n !== shown);
      if (left.length) shownByChannel.set(message.channelId, left);
      else shownByChannel.delete(message.channelId);
    };
    shown.onclick = () => {
      window.focus();
      navigator_?.(path);
      shown.close();
    };
  } catch {
    // 알림 창을 띄울 수 없는 환경 (안드로이드 WebView 등)
  }
}
