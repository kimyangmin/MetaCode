import type { UserProfile } from '@metacode/shared';
import type { CommunitySummary, MessageDto } from '@metacode/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mentionCandidates } from '../chat/Composer';
import { mentionsMe, notifyMessage, setViewingChannel, shouldNotify } from './notify';
import { useNotificationSettings } from './settings';

const user = (id: string, username: string, displayName: string | null = null): UserProfile => ({
  id,
  username,
  displayName,
  avatarUrl: '',
  character: null,
});

const me = user('me', 'Alice');
const bob = user('b', 'dev-bob', '밥');
const message = (content: string, replyToAuthor?: UserProfile) => ({
  author: bob,
  channelId: 'c1',
  content,
  replyTo: replyToAuthor
    ? { id: 'r', author: replyToAuthor, content: '', attachmentCount: 0 }
    : null,
});

describe('나를 부른 메시지', () => {
  it('@내아이디(대소문자 상관없이)나 내 메시지에 단 답장이면 부른 것이다', () => {
    expect(mentionsMe(message('@alice 안녕'), me)).toBe(true);
    expect(mentionsMe(message('그냥 alice'), me)).toBe(false);
    expect(mentionsMe(message('`@alice`'), me)).toBe(false);
    expect(mentionsMe(message('답장', me), me)).toBe(true);
    expect(mentionsMe({ ...message('@alice'), author: me }, me)).toBe(false);
  });
});

describe('알릴지', () => {
  const base = { me, isDm: false, viewing: false };
  it('기본(DM과 멘션)은 DM과 나를 부른 메시지만, 모든 메시지는 다, 받지 않음은 하나도', () => {
    expect(shouldNotify({ ...base, level: 'mentions', message: message('안녕') })).toBe(false);
    expect(shouldNotify({ ...base, level: 'mentions', message: message('@Alice') })).toBe(true);
    expect(shouldNotify({ ...base, level: 'mentions', isDm: true, message: message('안녕') })).toBe(
      true,
    );
    expect(shouldNotify({ ...base, level: 'all', message: message('안녕') })).toBe(true);
    expect(shouldNotify({ ...base, level: 'off', message: message('@Alice') })).toBe(false);
  });

  it('보고 있는 채널이나 내가 보낸 메시지는 알리지 않는다', () => {
    expect(shouldNotify({ ...base, level: 'all', viewing: true, message: message('@Alice') })).toBe(
      false,
    );
    expect(
      shouldNotify({ ...base, level: 'all', message: { ...message('안녕'), author: me } }),
    ).toBe(false);
  });
});

describe('멘션 고르기', () => {
  const people = [me, bob, user('c', 'carol', '캐롤'), user('d', 'bobby')];
  it('아이디가 그 글자로 시작하거나 닉네임에 있으면 고르고, 나는 빼며, 아이디로 맞는 사람이 먼저', () => {
    expect(mentionCandidates(people, 'bo', me.id).map((p) => p.username)).toEqual(['bobby']);
    expect(mentionCandidates(people, '밥', me.id).map((p) => p.username)).toEqual(['dev-bob']);
    expect(mentionCandidates(people, '', me.id)).toHaveLength(3);
  });
});

describe('시스템 알림 창', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('같은 채널의 알림도 메시지마다 따로 띄우고, 그 채널을 열면 걷는다', () => {
    const shown: { tag: string; closed: boolean; close(): void; onclose?: () => void }[] = [];
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'granted';
        tag: string;
        closed = false;
        onclose?: () => void;
        constructor(_title: string, options: { tag: string }) {
          this.tag = options.tag;
          shown.push(this);
        }
        close() {
          this.closed = true;
          this.onclose?.();
        }
      },
    );
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    vi.stubGlobal('location', { pathname: '/dm', hash: '' });
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => false });
    useNotificationSettings.setState({ level: 'mentions', sound: false, desktop: true });
    const community = {
      id: 'k',
      name: '커뮤니티',
      channels: [{ id: 'c1', name: '일반' }],
    } as unknown as CommunitySummary;
    const send = (id: string) =>
      notifyMessage({
        message: { ...message('@alice'), id, attachments: [] } as unknown as MessageDto,
        me,
        communities: [community],
        dms: [],
      });
    send('m1');
    send('m2');
    // 예전엔 둘 다 채널 ID 태그라 두 번째가 첫 번째를 조용히 바꿔 보이지 않았다
    expect(shown.map((n) => n.tag)).toEqual(['m1', 'm2']);
    setViewingChannel('c1');
    expect(shown.every((n) => n.closed)).toBe(true);
    setViewingChannel(null);
  });
});
