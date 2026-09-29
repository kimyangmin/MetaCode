import { type FriendChanged, type FriendsList, SocketEvent } from '@metacode/shared';
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

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function connect(user: TestUser) {
  const socket = await connectSocket(t, user);
  sockets.push(socket);
  return socket;
}

const request = (from: TestUser, to: TestUser) =>
  from.fetch('/friends/requests', json('POST', { username: to.me.username }));

describe('친구', () => {
  it('사용자 ID로 요청하고 상대가 수락하면 서로 친구가 되며, 두 사람 모두에게 알린다', async () => {
    const alice = await loginUser(t);
    const bob = await loginUser(t);
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);

    const incoming = nextEvent(bobSocket, SocketEvent.FriendUpdated);
    const sent = await request(alice, bob);
    expect(sent.status).toBe(201);
    expect(await sent.json()).toEqual({ userId: bob.me.id, status: 'outgoing' });
    expect(await incoming).toEqual({ userId: alice.me.id, status: 'incoming' });

    const bobList = await bob.json<FriendsList>('/friends');
    expect(bobList.incoming.map((r) => r.user.id)).toEqual([alice.me.id]);
    expect((await alice.json<FriendsList>('/friends')).outgoing).toHaveLength(1);

    const accepted = nextEvent(aliceSocket, SocketEvent.FriendUpdated);
    const res = await bob.fetch(`/friends/requests/${alice.me.id}/accept`, json('POST'));
    expect(res.status).toBe(201);
    expect(await accepted).toEqual({ userId: bob.me.id, status: 'friends' });

    const aliceList = await alice.json<FriendsList>('/friends');
    expect(aliceList.friends.map((f) => f.user.id)).toEqual([bob.me.id]);
    expect(aliceList.friends[0]!.online).toBe(true);
    expect(aliceList.outgoing).toEqual([]);
  });

  it('상대의 요청이 이미 와 있으면 요청하는 것만으로 친구가 된다', async () => {
    const alice = await loginUser(t);
    const bob = await loginUser(t);
    await request(alice, bob);
    const res = await request(bob, alice);
    expect(await res.json()).toEqual({ userId: alice.me.id, status: 'friends' });
    expect((await alice.json<FriendsList>('/friends')).friends).toHaveLength(1);
  });

  it('없는 사용자, 나 자신, 중복 요청, 이미 친구면 거절한다', async () => {
    const alice = await loginUser(t);
    const bob = await loginUser(t);
    const missing = await alice.fetch(
      '/friends/requests',
      json('POST', { username: 'no-such-user-xyz' }),
    );
    expect(missing.status).toBe(404);
    expect((await request(alice, alice)).status).toBe(400);
    await request(alice, bob);
    expect((await request(alice, bob)).status).toBe(409);
    await bob.fetch(`/friends/requests/${alice.me.id}/accept`, json('POST'));
    expect((await request(alice, bob)).status).toBe(409);
    // 받지 않은 요청은 수락할 수 없다
    const carol = await loginUser(t);
    expect(
      (await carol.fetch(`/friends/requests/${alice.me.id}/accept`, json('POST'))).status,
    ).toBe(404);
  });

  it('거절·취소·끊기는 관계를 지우고 두 사람에게 알린다', async () => {
    const alice = await loginUser(t);
    const bob = await loginUser(t);
    const aliceSocket = await connect(alice);
    await request(alice, bob);
    const declined = nextEvent(aliceSocket, SocketEvent.FriendUpdated);
    expect((await bob.fetch(`/friends/${alice.me.id}`, json('DELETE'))).status).toBe(200);
    expect(await declined).toEqual({ userId: bob.me.id, status: 'none' } satisfies FriendChanged);
    expect((await alice.json<FriendsList>('/friends')).outgoing).toEqual([]);
    expect((await bob.fetch(`/friends/${alice.me.id}`, json('DELETE'))).status).toBe(404);
  });

  it('친구가 되면 서로의 온라인 상태를 받고, 끊으면 더 받지 않는다', async () => {
    const alice = await loginUser(t);
    const bob = await loginUser(t);
    const aliceSocket = await connect(alice);
    await request(alice, bob);
    await bob.fetch(`/friends/requests/${alice.me.id}/accept`, json('POST'));

    const online = nextEvent(aliceSocket, SocketEvent.PresenceChanged);
    const bobSocket = await connect(bob);
    expect(await online).toEqual({ userId: bob.me.id, online: true });

    await alice.fetch(`/friends/${bob.me.id}`, json('DELETE'));
    // 보내기(끊기) 전에 걸어 둔다 (CLAUDE.md 테스트 주의)
    const none = expectNoEvent(aliceSocket, SocketEvent.PresenceChanged);
    bobSocket.disconnect();
    await none;
  });
});
