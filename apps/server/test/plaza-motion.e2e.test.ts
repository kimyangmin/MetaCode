import {
  type CommunitySummary,
  type InviteInfo,
  type PlazaId,
  type PlazaSnapshot,
  type SocketAck,
  SocketEvent,
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

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connect(user: TestUser) {
  const socket = await connectSocket(t, user);
  sockets.push(socket);
  return socket;
}

async function watch(socket: ClientSocket, plazaId: string): Promise<PlazaSnapshot> {
  const ack = await new Promise<SocketAck<PlazaSnapshot>>((resolve) =>
    socket.emit(SocketEvent.PlazaWatch, { plazaId }, resolve),
  );
  if (!ack.ok) throw new Error(ack.error);
  return ack.data;
}

async function setup() {
  const [alice, bob] = await Promise.all([loginUser(t), loginUser(t)]);
  const community = await alice.json<CommunitySummary>('/communities', post({ name: '모션' }));
  const invite = await alice.json<InviteInfo>(`/communities/${community.id}/invites`, post());
  await bob.json(`/invites/${invite.code}/accept`, post());
  const plazaId: PlazaId = `community:${community.id}`;
  return { alice, bob, plazaId };
}

describe('캐릭터 모션', () => {
  it('모션은 같은 광장을 보는 다른 사람에게 가고, 반복 모션은 나중에 연 사람에게도 보인다', async () => {
    const { alice, bob, plazaId } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    await watch(aliceSocket, plazaId);
    await watch(bobSocket, plazaId);

    const changed = nextEvent(bobSocket, SocketEvent.PlazaMotionChanged);
    aliceSocket.emit(SocketEvent.PlazaSetMotion, { plazaId, motion: 'motion-1', loop: true });
    expect(await changed).toEqual({
      plazaId,
      userId: alice.me.id,
      motion: 'motion-1',
      loop: true,
    });
    await expectNoEvent(aliceSocket, SocketEvent.PlazaMotionChanged);

    const late = await connect(bob);
    const snapshot = await watch(late, plazaId);
    expect(snapshot.occupants.find((o) => o.user.id === alice.me.id)?.motion).toBe('motion-1');
    expect(snapshot.occupants.find((o) => o.user.id === bob.me.id)?.motion).toBeNull();
  });

  it('움직이면 반복 모션이 멈추고, 한 번 트는 모션은 남지 않는다', async () => {
    const { alice, plazaId } = await setup();
    const socket = await connect(alice);
    const me = (await watch(socket, plazaId)).occupants[0]!;
    socket.emit(SocketEvent.PlazaSetMotion, { plazaId, motion: 'motion-1', loop: true });
    await sleep(200);
    socket.emit(SocketEvent.PlazaMove, {
      plazaId,
      x: me.x + 4,
      y: me.y,
      dir: 'right',
      moving: true,
    });
    await sleep(200);
    expect((await watch(socket, plazaId)).occupants[0]!.motion).toBeNull();

    socket.emit(SocketEvent.PlazaSetMotion, { plazaId, motion: 'motion-2', loop: false });
    await sleep(200);
    expect((await watch(socket, plazaId)).occupants[0]!.motion).toBeNull();
  });

  it('광장을 열지 않았거나 이름이 틀리면 무시하고, 너무 잦은 요청은 버린다', async () => {
    const { alice, bob, plazaId } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    await watch(bobSocket, plazaId);

    const notWatching = expectNoEvent(bobSocket, SocketEvent.PlazaMotionChanged);
    aliceSocket.emit(SocketEvent.PlazaSetMotion, { plazaId, motion: 'motion-1', loop: false });
    await notWatching;

    await watch(aliceSocket, plazaId);
    const invalid = expectNoEvent(bobSocket, SocketEvent.PlazaMotionChanged);
    aliceSocket.emit(SocketEvent.PlazaSetMotion, { plazaId, motion: 'Bad Name!', loop: false });
    await invalid;

    await sleep(200);
    const received: unknown[] = [];
    bobSocket.on(SocketEvent.PlazaMotionChanged, (e) => received.push(e));
    for (let i = 0; i < 5; i++) {
      aliceSocket.emit(SocketEvent.PlazaSetMotion, { plazaId, motion: 'motion-1', loop: false });
    }
    await sleep(400);
    expect(received).toHaveLength(1);
  });
});
