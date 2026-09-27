import {
  type CommunityMember,
  type CommunitySummary,
  type DmSummary,
  type InviteInfo,
  type MessageDto,
  type MessagePage,
  type SocketAck,
  SocketEvent,
  type UserProfile,
  hasUnread,
} from '@metacode/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type ClientSocket,
  type TestApp,
  type TestUser,
  connectSocket,
  expectNoEvent,
  loginUser,
  nextEvent,
  startTestApp,
} from './harness.js';

let t: TestApp;
let sockets: ClientSocket[] = [];

beforeAll(async () => {
  t = await startTestApp();
});

afterEach(() => {
  for (const s of sockets) s.disconnect();
  sockets = [];
});

afterAll(async () => {
  await t.close();
});

async function connect(user: TestUser) {
  const socket = await connectSocket(t, user);
  sockets.push(socket);
  return socket;
}

function send(socket: ClientSocket, channelId: string, content: string) {
  return new Promise<SocketAck<MessageDto>>((resolve) =>
    socket.emit(SocketEvent.MessageSend, { channelId, content }, resolve),
  );
}

async function sendOk(socket: ClientSocket, channelId: string, content: string) {
  const ack = await send(socket, channelId, content);
  if (!ack.ok) throw new Error(ack.error);
  return ack.data;
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** alice가 만든 커뮤니티에 bob이 초대로 들어온 상태 */
async function communityWithAliceAndBob() {
  const alice = await loginUser(t);
  const bob = await loginUser(t);
  const community = await alice.json<CommunitySummary>(
    '/communities',
    post({ name: '팀 MetaCode' }),
  );
  const invite = await alice.json<InviteInfo>(`/communities/${community.id}/invites`, post());
  await bob.json<CommunitySummary>(`/invites/${invite.code}/accept`, post());
  const general = community.channels[0]!;
  return { alice, bob, community, invite, general };
}

describe('커뮤니티', () => {
  it('만들면 소유자가 되고 기본 텍스트 채널 "일반"이 생긴다', async () => {
    const alice = await loginUser(t);
    const community = await alice.json<CommunitySummary>('/communities', post({ name: '  팀  ' }));

    expect(community).toMatchObject({ name: '팀', myRole: 'OWNER' });
    expect(community.channels).toHaveLength(1);
    expect(community.channels[0]).toMatchObject({ type: 'TEXT', name: '일반' });
    expect(await alice.json<CommunitySummary[]>('/communities')).toHaveLength(1);
  });

  it('초대 링크로 들어오면 멤버가 되고, 기존 멤버에게 실시간으로 알린다', async () => {
    const alice = await loginUser(t);
    const bob = await loginUser(t);
    const community = await alice.json<CommunitySummary>('/communities', post({ name: '팀' }));
    const invite = await alice.json<InviteInfo>(`/communities/${community.id}/invites`, post());
    expect(invite.code).toMatch(/^[A-Za-z0-9]{8}$/);

    const preview = await bob.json<InviteInfo>(`/invites/${invite.code}`);
    expect(preview).toMatchObject({ communityName: '팀', memberCount: 1, joined: false });

    const aliceSocket = await connect(alice);
    const joined = nextEvent(aliceSocket, SocketEvent.CommunityMemberJoined);
    const accepted = await bob.json<CommunitySummary>(`/invites/${invite.code}/accept`, post());
    expect(accepted).toMatchObject({ id: community.id, myRole: 'MEMBER' });
    expect((await joined).member.user.id).toBe(bob.me.id);

    // 다시 수락해도 그대로다.
    await bob.json(`/invites/${invite.code}/accept`, post());
    const members = await alice.json<CommunityMember[]>(`/communities/${community.id}/members`);
    expect(members.map((m) => [m.user.id, m.role])).toEqual([
      [alice.me.id, 'OWNER'],
      [bob.me.id, 'MEMBER'],
    ]);
  });

  it('없는 초대 코드는 404, 형식이 틀린 코드는 400', async () => {
    const alice = await loginUser(t);
    expect((await alice.fetch('/invites/NOPE1234')).status).toBe(404);
    expect((await alice.fetch('/invites/%20bad!')).status).toBe(400);
  });

  it('채널은 관리자만 만들 수 있고, 만들면 멤버 전원이 바로 그 채널의 메시지를 받는다', async () => {
    const { alice, bob, community } = await communityWithAliceAndBob();
    expect(
      (await bob.fetch(`/communities/${community.id}/channels`, post({ name: 'x' }))).status,
    ).toBe(403);

    const bobSocket = await connect(bob);
    const created = nextEvent(bobSocket, SocketEvent.ChannelCreated);
    const channel = await alice.json<{ id: string; name: string }>(
      `/communities/${community.id}/channels`,
      post({ name: 'Dev Talk' }),
    );
    expect(channel.name).toBe('dev-talk');
    expect((await created).id).toBe(channel.id);

    const aliceSocket = await connect(alice);
    const received = nextEvent(bobSocket, SocketEvent.MessageCreated);
    await sendOk(aliceSocket, channel.id, '새 채널 첫 메시지');
    expect((await received).content).toBe('새 채널 첫 메시지');
  });

  it('멤버가 나가면 알리고, 나간 사람은 더 이상 메시지를 받거나 볼 수 없다. 소유자는 나갈 수 없다', async () => {
    const { alice, bob, community, general } = await communityWithAliceAndBob();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);

    const left = nextEvent(aliceSocket, SocketEvent.CommunityMemberLeft);
    expect((await bob.fetch(`/communities/${community.id}/leave`, post())).status).toBe(204);
    expect((await left).userId).toBe(bob.me.id);

    // 받지 않는지는 보내기 전부터 지켜본다 (보내기 확인보다 이벤트가 먼저 올 수 있다).
    const notReceived = expectNoEvent(bobSocket, SocketEvent.MessageCreated);
    await sendOk(aliceSocket, general.id, '나간 뒤 메시지');
    await notReceived;
    expect((await bob.fetch(`/channels/${general.id}/messages`)).status).toBe(404);
    expect((await alice.fetch(`/communities/${community.id}/leave`, post())).status).toBe(403);
  });

  it('소유자만 삭제할 수 있고, 삭제하면 멤버에게 알린다', async () => {
    const { alice, bob, community } = await communityWithAliceAndBob();
    expect((await bob.fetch(`/communities/${community.id}`, { method: 'DELETE' })).status).toBe(
      403,
    );

    const bobSocket = await connect(bob);
    const deleted = nextEvent(bobSocket, SocketEvent.CommunityDeleted);
    expect((await alice.fetch(`/communities/${community.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await deleted).communityId).toBe(community.id);
    expect(await bob.json<CommunitySummary[]>('/communities')).toEqual([]);
  });
});

describe('메시지', () => {
  it('보내면 채널의 모든 연결(내 다른 탭 포함)이 받고, 기록에 남는다', async () => {
    const { alice, bob, general } = await communityWithAliceAndBob();
    const aliceSocket = await connect(alice);
    const bobTab1 = await connect(bob);
    const bobTab2 = await connect(bob);

    const toAlice = nextEvent(aliceSocket, SocketEvent.MessageCreated);
    const toBobTab2 = nextEvent(bobTab2, SocketEvent.MessageCreated);
    const sent = await sendOk(bobTab1, general.id, '  안녕하세요  ');

    expect(sent).toMatchObject({ channelId: general.id, content: '안녕하세요' });
    expect(sent.author.id).toBe(bob.me.id);
    expect((await toAlice).id).toBe(sent.id);
    expect((await toBobTab2).id).toBe(sent.id);

    const page = await alice.json<MessagePage>(`/channels/${general.id}/messages`);
    expect(page.messages.map((m) => m.id)).toEqual([sent.id]);
  });

  it('기록은 최신부터 주고, before로 이전 페이지를 이어서 받는다', async () => {
    const { alice, general } = await communityWithAliceAndBob();
    const socket = await connect(alice);
    const sent: MessageDto[] = [];
    for (let i = 1; i <= 5; i++) sent.push(await sendOk(socket, general.id, `메시지 ${i}`));

    const first = await alice.json<MessagePage>(`/channels/${general.id}/messages?limit=2`);
    expect(first.messages.map((m) => m.content)).toEqual(['메시지 5', '메시지 4']);
    expect(first.hasMore).toBe(true);

    const second = await alice.json<MessagePage>(
      `/channels/${general.id}/messages?limit=2&before=${first.messages.at(-1)!.id}`,
    );
    expect(second.messages.map((m) => m.content)).toEqual(['메시지 3', '메시지 2']);

    const last = await alice.json<MessagePage>(
      `/channels/${general.id}/messages?limit=2&before=${second.messages.at(-1)!.id}`,
    );
    expect(last.messages.map((m) => m.content)).toEqual(['메시지 1']);
    expect(last.hasMore).toBe(false);
  });

  it('커뮤니티 밖 사람은 기록을 볼 수 없고, 보낼 수 없고, 실시간으로도 받지 않는다', async () => {
    const { alice, general, community } = await communityWithAliceAndBob();
    const carol = await loginUser(t);
    const carolSocket = await connect(carol);
    const aliceSocket = await connect(alice);

    expect((await carol.fetch(`/channels/${general.id}/messages`)).status).toBe(404);
    expect((await carol.fetch(`/communities/${community.id}/members`)).status).toBe(404);
    const ack = await send(carolSocket, general.id, '끼어들기');
    expect(ack.ok).toBe(false);

    const notReceived = expectNoEvent(carolSocket, SocketEvent.MessageCreated);
    await sendOk(aliceSocket, general.id, '멤버끼리만');
    await notReceived;
  });

  it('빈 메시지나 너무 긴 메시지는 거절한다', async () => {
    const { alice, general } = await communityWithAliceAndBob();
    const socket = await connect(alice);
    expect((await send(socket, general.id, '   ')).ok).toBe(false);
    expect((await send(socket, general.id, 'a'.repeat(4001))).ok).toBe(false);
    expect((await send(socket, 'not-a-uuid', 'hi')).ok).toBe(false);
  });

  it('형식이 틀린 채널 ID로 기록을 요청하면 400', async () => {
    const alice = await loginUser(t);
    expect((await alice.fetch('/channels/not-a-uuid/messages')).status).toBe(400);
  });
});

describe('입력 중 표시', () => {
  it('같은 채널 사람에게만 알리고, 보낸 연결에는 돌려보내지 않는다', async () => {
    const { alice, bob, general } = await communityWithAliceAndBob();
    const carol = await loginUser(t);
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const carolSocket = await connect(carol);

    const typing = nextEvent(aliceSocket, SocketEvent.TypingStarted);
    bobSocket.emit(SocketEvent.TypingStart, { channelId: general.id });
    expect(await typing).toEqual({ channelId: general.id, userId: bob.me.id });
    await expectNoEvent(bobSocket, SocketEvent.TypingStarted);

    // 채널에 접근할 수 없는 사람의 입력 중 신호는 무시한다.
    carolSocket.emit(SocketEvent.TypingStart, { channelId: general.id });
    await expectNoEvent(aliceSocket, SocketEvent.TypingStarted, (p) => p.userId === carol.me.id);
  });
});

describe('읽음 처리', () => {
  it('새 메시지가 오면 안 읽음이 되고, 읽음 위치를 옮기면 풀리며, 뒤로는 돌아가지 않는다', async () => {
    const { alice, bob, general, community } = await communityWithAliceAndBob();
    const bobSocket = await connect(bob);
    const first = await sendOk(bobSocket, general.id, '첫 번째');
    const second = await sendOk(bobSocket, general.id, '두 번째');

    const channelOf = async () =>
      (await alice.json<CommunitySummary[]>('/communities'))
        .find((c) => c.id === community.id)!
        .channels.find((ch) => ch.id === general.id)!;

    expect(hasUnread(await channelOf())).toBe(true);

    const put = (id: string) =>
      alice.fetch(`/channels/${general.id}/read-state`, {
        method: 'PUT',
        body: JSON.stringify({ lastReadMessageId: id }),
      });
    expect((await put(second.id)).status).toBe(204);
    expect(await channelOf()).toMatchObject({
      lastMessageId: second.id,
      lastReadMessageId: second.id,
    });

    await put(first.id);
    expect((await channelOf()).lastReadMessageId).toBe(second.id);
  });

  it('다른 채널의 메시지로는 읽음 위치를 옮길 수 없다', async () => {
    const { alice, general, community } = await communityWithAliceAndBob();
    const other = await alice.json<{ id: string }>(
      `/communities/${community.id}/channels`,
      post({ name: '다른' }),
    );
    const socket = await connect(alice);
    const message = await sendOk(socket, other.id, '다른 채널');
    const res = await alice.fetch(`/channels/${general.id}/read-state`, {
      method: 'PUT',
      body: JSON.stringify({ lastReadMessageId: message.id }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DM', () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeEach(async () => {
    [alice, bob, carol] = [await loginUser(t), await loginUser(t), await loginUser(t)];
  });

  it('1:1 DM은 상대에게 알리고, 다시 열면 같은 대화를 돌려준다', async () => {
    const carolSocket = await connect(carol);
    const created = nextEvent(carolSocket, SocketEvent.DmCreated);

    const res = await alice.fetch('/dms', post({ userIds: [carol.me.id] }));
    expect(res.status).toBe(201);
    const dm = (await res.json()) as DmSummary;
    expect(dm.type).toBe('DM');
    expect(dm.participants.map((p) => p.id).sort()).toEqual([alice.me.id, carol.me.id].sort());
    expect((await created).id).toBe(dm.id);

    // 상대가 먼저 열어도 같은 대화다.
    const again = await carol.fetch('/dms', post({ userIds: [alice.me.id] }));
    expect(again.status).toBe(200);
    expect(((await again.json()) as DmSummary).id).toBe(dm.id);
  });

  it('DM 메시지는 참여자만 주고받는다', async () => {
    const dm = await alice.json<DmSummary>('/dms', post({ userIds: [carol.me.id] }));
    const aliceSocket = await connect(alice);
    const carolSocket = await connect(carol);
    const bobSocket = await connect(bob);

    const received = nextEvent(aliceSocket, SocketEvent.MessageCreated);
    const notReceived = expectNoEvent(bobSocket, SocketEvent.MessageCreated);
    await sendOk(carolSocket, dm.id, '비밀 이야기');
    expect((await received).content).toBe('비밀 이야기');
    await notReceived;
    expect((await bob.fetch(`/channels/${dm.id}/messages`)).status).toBe(404);
    expect((await send(bobSocket, dm.id, '엿보기')).ok).toBe(false);
  });

  it('상대가 2명 이상이면 그룹 DM이 되고, 목록은 최근 대화가 위로 온다', async () => {
    const group = await alice.json<DmSummary>('/dms', post({ userIds: [bob.me.id, carol.me.id] }));
    expect(group.type).toBe('GROUP_DM');
    expect(group.participants).toHaveLength(3);
    const direct = await alice.json<DmSummary>('/dms', post({ userIds: [bob.me.id] }));

    const socket = await connect(alice);
    await sendOk(socket, direct.id, '먼저');
    await sendOk(socket, group.id, '나중');
    const list = await alice.json<DmSummary[]>('/dms');
    expect(list.map((d) => d.id)).toEqual([group.id, direct.id]);
  });

  it('나 자신이나 없는 사용자와는 DM을 열 수 없다', async () => {
    expect((await alice.fetch('/dms', post({ userIds: [alice.me.id] }))).status).toBe(400);
    expect(
      (await alice.fetch('/dms', post({ userIds: ['0190a8a0-0000-7000-8000-000000000999'] })))
        .status,
    ).toBe(400);
  });
});

describe('온라인 상태 알림과 사용자 검색', () => {
  it('같은 커뮤니티 멤버가 접속하거나 나가면 알리고, 멤버 목록에 온라인 여부가 나온다', async () => {
    const { alice, bob, community } = await communityWithAliceAndBob();
    const aliceSocket = await connect(alice);

    const online = nextEvent(
      aliceSocket,
      SocketEvent.PresenceChanged,
      (p) => p.userId === bob.me.id,
    );
    const bobSocket = await connect(bob);
    expect(await online).toEqual({ userId: bob.me.id, online: true });

    const members = await alice.json<CommunityMember[]>(`/communities/${community.id}/members`);
    expect(members.find((m) => m.user.id === bob.me.id)?.online).toBe(true);

    const offline = nextEvent(
      aliceSocket,
      SocketEvent.PresenceChanged,
      (p) => p.userId === bob.me.id,
    );
    bobSocket.disconnect();
    expect(await offline).toEqual({ userId: bob.me.id, online: false });
  });

  it('GitHub 아이디 앞부분으로 다른 사용자를 찾는다 (나는 제외)', async () => {
    const alice = await loginUser(t, { login: 'alice-search' });
    const bob = await loginUser(t, { login: 'alice-search-bob' });
    const found = await alice.json<UserProfile[]>('/users/search?q=ALICE-SEARCH');
    expect(found.map((u) => u.id)).toEqual([bob.me.id]);
  });
});
