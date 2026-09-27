import {
  type ChannelSummary,
  type CommunityMember,
  type CommunitySummary,
  type InviteInfo,
  type MessageDto,
  type RoleDto,
  type SocketAck,
  SocketEvent,
  type VoiceJoinResult,
} from '@metacode/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
const post = (body?: unknown) => send('POST', body);

async function connect(user: TestUser) {
  const socket = await connectSocket(t, user);
  sockets.push(socket);
  return socket;
}

function say(socket: ClientSocket, channelId: string, content: string) {
  return new Promise<SocketAck<MessageDto>>((resolve) =>
    socket.emit(SocketEvent.MessageSend, { channelId, content }, resolve),
  );
}

const channelIds = async (user: TestUser, communityId: string) =>
  (await user.json<CommunitySummary[]>('/communities'))
    .find((c) => c.id === communityId)!
    .channels.map((c) => c.id);

/** 소유자 alice, 멤버 bob과 carol. "디자인" 역할과, 그 역할만 보는 비공개 채널 */
async function setup() {
  const alice = await loginUser(t);
  const bob = await loginUser(t);
  const carol = await loginUser(t);
  const community = await alice.json<CommunitySummary>('/communities', post({ name: '역할' }));
  const invite = await alice.json<InviteInfo>(`/communities/${community.id}/invites`, post());
  await bob.json(`/invites/${invite.code}/accept`, post());
  await carol.json(`/invites/${invite.code}/accept`, post());
  const design = await alice.json<RoleDto>(
    `/communities/${community.id}/roles`,
    post({ name: '디자인', color: '#E5534B' }),
  );
  await alice.fetch(
    `/communities/${community.id}/members/${bob.me.id}/roles`,
    send('PUT', { roleIds: [design.id] }),
  );
  const secret = await alice.json<ChannelSummary>(
    `/communities/${community.id}/channels`,
    post({ name: '비밀', private: true, roleIds: [design.id] }),
  );
  return { alice, bob, carol, community, design, secret };
}

describe('역할', () => {
  it('관리자가 역할을 만들고 멤버에게 주면 커뮤니티 정보와 멤버 목록에 보인다', async () => {
    const { alice, bob, community, design } = await setup();
    expect(design).toMatchObject({ name: '디자인', color: '#e5534b' });

    const summary = (await bob.json<CommunitySummary[]>('/communities')).find(
      (c) => c.id === community.id,
    )!;
    expect(summary.roles.map((r) => r.name)).toEqual(['디자인']);

    const members = await alice.json<CommunityMember[]>(`/communities/${community.id}/members`);
    expect(members.find((m) => m.user.id === bob.me.id)?.roleIds).toEqual([design.id]);
  });

  it('같은 이름의 역할은 만들 수 없고, 다른 커뮤니티의 역할은 줄 수 없다', async () => {
    const { alice, bob, community } = await setup();
    const duplicate = await alice.fetch(
      `/communities/${community.id}/roles`,
      post({ name: '디자인' }),
    );
    expect(duplicate.status).toBe(409);

    const other = await alice.json<CommunitySummary>('/communities', post({ name: '다른 곳' }));
    const foreign = await alice.json<RoleDto>(
      `/communities/${other.id}/roles`,
      post({ name: 'x' }),
    );
    const res = await alice.fetch(
      `/communities/${community.id}/members/${bob.me.id}/roles`,
      send('PUT', { roleIds: [foreign.id] }),
    );
    expect(res.status).toBe(400);
  });

  it('멤버는 역할, 채널 권한을 바꿀 수 없다', async () => {
    const { bob, community, design, secret } = await setup();
    expect(
      (await bob.fetch(`/communities/${community.id}/roles`, post({ name: 'x' }))).status,
    ).toBe(403);
    expect(
      (
        await bob.fetch(
          `/communities/${community.id}/members/${bob.me.id}/roles`,
          send('PUT', { roleIds: [design.id] }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await bob.fetch(`/channels/${secret.id}`, send('PATCH', { private: false }))).status,
    ).toBe(403);
  });
});

describe('비공개 채널', () => {
  it('허용된 역할을 가진 멤버와 관리자만 보고 읽고 쓴다', async () => {
    const { alice, bob, carol, community, secret } = await setup();
    expect(await channelIds(alice, community.id)).toContain(secret.id);
    expect(await channelIds(bob, community.id)).toContain(secret.id);
    expect(await channelIds(carol, community.id)).not.toContain(secret.id);

    // 존재 여부도 알려 주지 않는다 (404).
    expect((await carol.fetch(`/channels/${secret.id}/messages`)).status).toBe(404);
    expect((await say(await connect(carol), secret.id, '몰래')).ok).toBe(false);
    expect((await say(await connect(bob), secret.id, '안녕')).ok).toBe(true);
  });

  it('비공개 채널의 메시지는 볼 수 있는 사람의 연결에만 간다 (광장 말풍선도 이 스트림을 쓴다)', async () => {
    const { alice, bob, carol, secret } = await setup();
    const aliceSocket = await connect(alice);
    const carolSocket = await connect(carol);
    const bobSocket = await connect(bob);

    // 받지 않는지는 보내기 전부터 지켜봐야 한다 (보내기 확인보다 이벤트가 먼저 올 수 있다).
    const received = nextEvent(aliceSocket, SocketEvent.MessageCreated);
    const notReceived = expectNoEvent(carolSocket, SocketEvent.MessageCreated);
    await say(bobSocket, secret.id, '비밀 이야기');
    expect((await received).content).toBe('비밀 이야기');
    await notReceived;
  });

  it('역할을 빼면 바로 볼 수 없게 되고 메시지도 더 받지 않는다. 다시 주면 받는다', async () => {
    const { alice, bob, community, design, secret } = await setup();
    const bobSocket = await connect(bob);
    const aliceSocket = await connect(alice);

    const updated = nextEvent(bobSocket, SocketEvent.CommunityUpdated);
    await alice.fetch(
      `/communities/${community.id}/members/${bob.me.id}/roles`,
      send('PUT', { roleIds: [] }),
    );
    expect(await updated).toEqual({ communityId: community.id });
    expect(await channelIds(bob, community.id)).not.toContain(secret.id);
    const notReceived = expectNoEvent(bobSocket, SocketEvent.MessageCreated);
    await say(aliceSocket, secret.id, '이제 못 봄');
    await notReceived;

    await alice.fetch(
      `/communities/${community.id}/members/${bob.me.id}/roles`,
      send('PUT', { roleIds: [design.id] }),
    );
    const again = nextEvent(bobSocket, SocketEvent.MessageCreated);
    await say(aliceSocket, secret.id, '다시 보임');
    expect((await again).content).toBe('다시 보임');
  });

  it('채널을 공개로 바꾸면 모두 보고, 역할을 지우면 그 역할로 보던 사람은 못 본다', async () => {
    const { alice, bob, carol, community, design, secret } = await setup();

    const updated = await alice.json<ChannelSummary>(
      `/channels/${secret.id}`,
      send('PATCH', { private: false, name: '공개 채널' }),
    );
    expect(updated).toMatchObject({ private: false, name: '공개-채널' });
    expect(await channelIds(carol, community.id)).toContain(secret.id);

    await alice.fetch(`/channels/${secret.id}`, send('PATCH', { private: true }));
    await alice.fetch(`/communities/${community.id}/roles/${design.id}`, send('DELETE'));
    expect(await channelIds(bob, community.id)).not.toContain(secret.id);
    expect(await channelIds(alice, community.id)).toContain(secret.id);
  });

  it('볼 수 없게 되면 그 음성 채널의 통화에서 빠진다', async () => {
    const { alice, bob, community, design } = await setup();
    const voice = await alice.json<ChannelSummary>(
      `/communities/${community.id}/channels`,
      post({ name: '회의', type: 'VOICE', private: true, roleIds: [design.id] }),
    );
    const bobSocket = await connect(bob);
    const joined = await new Promise<SocketAck<VoiceJoinResult>>((resolve) =>
      bobSocket.emit(SocketEvent.VoiceJoin, { channelId: voice.id }, resolve),
    );
    expect(joined.ok).toBe(true);

    const left = nextEvent(bobSocket, SocketEvent.VoiceLeft);
    await alice.fetch(
      `/communities/${community.id}/members/${bob.me.id}/roles`,
      send('PUT', { roleIds: [] }),
    );
    expect(await left).toEqual({ channelId: voice.id, userId: bob.me.id });
  });
});

describe('관리자', () => {
  it('소유자만 관리자를 정하고, 관리자는 모든 비공개 채널을 보고 역할을 관리한다', async () => {
    const { alice, bob, carol, community, secret } = await setup();
    // 관리자가 아니면 관리자를 정할 수 없다.
    expect(
      (
        await bob.fetch(
          `/communities/${community.id}/members/${carol.me.id}/admin`,
          send('PUT', { admin: true }),
        )
      ).status,
    ).toBe(403);

    await alice.fetch(
      `/communities/${community.id}/members/${carol.me.id}/admin`,
      send('PUT', { admin: true }),
    );
    expect(await channelIds(carol, community.id)).toContain(secret.id);
    const role = await carol.fetch(`/communities/${community.id}/roles`, post({ name: '운영' }));
    expect(role.status).toBe(201);

    // 관리자도 다른 관리자를 정할 수는 없다. 소유자는 바꿀 수 없다.
    expect(
      (
        await carol.fetch(
          `/communities/${community.id}/members/${bob.me.id}/admin`,
          send('PUT', { admin: true }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await alice.fetch(
          `/communities/${community.id}/members/${alice.me.id}/admin`,
          send('PUT', { admin: false }),
        )
      ).status,
    ).toBe(400);

    // 관리자에서 내리면 역할이 없으니 비공개 채널을 못 본다.
    await alice.fetch(
      `/communities/${community.id}/members/${carol.me.id}/admin`,
      send('PUT', { admin: false }),
    );
    expect(await channelIds(carol, community.id)).not.toContain(secret.id);
  });
});
