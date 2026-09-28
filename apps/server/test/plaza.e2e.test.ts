import {
  type CommunitySummary,
  type DmSummary,
  type InviteInfo,
  type PlazaId,
  type PlazaSnapshot,
  type SocketAck,
  SocketEvent,
  TILE_SIZE,
  isWalkable,
} from '@metacode/shared';
import { BUILTIN_LAYOUTS, BUILTIN_MAPS } from '@metacode/shared/builtin-assets';
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

async function connect(user: TestUser) {
  const socket = await connectSocket(t, user);
  sockets.push(socket);
  return socket;
}

function watch(socket: ClientSocket, plazaId: string) {
  return new Promise<SocketAck<PlazaSnapshot>>((resolve) =>
    socket.emit(SocketEvent.PlazaWatch, { plazaId }, resolve),
  );
}

async function watchOk(socket: ClientSocket, plazaId: string) {
  const ack = await watch(socket, plazaId);
  if (!ack.ok) throw new Error(ack.error);
  return ack.data;
}

function move(socket: ClientSocket, plazaId: PlazaId, x: number, y: number) {
  socket.emit(SocketEvent.PlazaMove, { plazaId, x, y, dir: 'right', moving: true });
}

/** alice가 만든 커뮤니티에 bob이 들어온 상태 */
async function setup() {
  const alice = await loginUser(t);
  const bob = await loginUser(t);
  const community = await alice.json<CommunitySummary>('/communities', post({ name: '광장' }));
  const invite = await alice.json<InviteInfo>(`/communities/${community.id}/invites`, post());
  await bob.json(`/invites/${invite.code}/accept`, post());
  const plazaId: PlazaId = `community:${community.id}`;
  return { alice, bob, community, invite, plazaId };
}

describe('광장 열기', () => {
  it('커뮤니티 광장은 분수 광장이고, 온라인 멤버 전원이 설 수 있는 자리에 있다', async () => {
    const { alice, bob, plazaId } = await setup();
    const aliceSocket = await connect(alice);
    await connect(bob);

    const snapshot = await watchOk(aliceSocket, plazaId);
    expect(snapshot).toMatchObject({ plazaId, map: 'fountain-square', theme: 'default' });
    expect(snapshot.definition).toEqual(BUILTIN_MAPS['fountain-square']);
    expect(snapshot.occupants.map((o) => o.user.id).sort()).toEqual(
      [alice.me.id, bob.me.id].sort(),
    );
    for (const o of snapshot.occupants) {
      expect(isWalkable(BUILTIN_LAYOUTS['fountain-square'], o.x, o.y)).toBe(true);
    }
  });

  it('오프라인 멤버는 광장에 없다', async () => {
    const { alice, bob, plazaId } = await setup();
    const snapshot = await watchOk(await connect(alice), plazaId);
    expect(snapshot.occupants.map((o) => o.user.id)).not.toContain(bob.me.id);
  });

  it('DM 광장은 모닥불 캠프이고 참여자만 열 수 있다', async () => {
    const { alice, bob } = await setup();
    const dm = await alice.json<DmSummary>('/dms', post({ userIds: [bob.me.id] }));
    const snapshot = await watchOk(await connect(alice), `dm:${dm.id}`);
    expect(snapshot.map).toBe('campfire');
    expect(snapshot.definition).toEqual(BUILTIN_MAPS.campfire);

    const carol = await loginUser(t);
    expect((await watch(await connect(carol), `dm:${dm.id}`)).ok).toBe(false);
  });

  it('멤버가 아니거나 형식이 틀린 광장은 열 수 없다', async () => {
    const { plazaId } = await setup();
    const carol = await loginUser(t);
    const socket = await connect(carol);
    expect((await watch(socket, plazaId)).ok).toBe(false);
    expect((await watch(socket, 'community:not-a-uuid')).ok).toBe(false);
    expect((await watch(socket, 'somewhere:else')).ok).toBe(false);
  });
});

describe('이동', () => {
  it('받아들인 이동은 같은 광장을 보는 다른 사람에게만 가고, 다시 열면 그 자리에 있다', async () => {
    const { alice, bob, plazaId } = await setup();
    const aliceSocket = await connect(alice);
    const bobWatching = await connect(bob);
    const bobNotWatching = await connect(bob);
    const start = (await watchOk(aliceSocket, plazaId)).occupants.find(
      (o) => o.user.id === alice.me.id,
    )!;
    await watchOk(bobWatching, plazaId);

    const moved = nextEvent(bobWatching, SocketEvent.PlazaMoved);
    move(aliceSocket, plazaId, start.x + 8, start.y);
    expect(await moved).toMatchObject({ plazaId, userId: alice.me.id, x: start.x + 8, y: start.y });
    await expectNoEvent(bobNotWatching, SocketEvent.PlazaMoved);
    await expectNoEvent(aliceSocket, SocketEvent.PlazaMoved);

    const again = await watchOk(bobWatching, plazaId);
    expect(again.occupants.find((o) => o.user.id === alice.me.id)).toMatchObject({
      x: start.x + 8,
      y: start.y,
    });
  });

  it('순간이동이나 장애물 안으로의 이동은 거절하고 원래 자리로 되돌린다', async () => {
    const { alice, bob, plazaId } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const start = (await watchOk(aliceSocket, plazaId)).occupants.find(
      (o) => o.user.id === alice.me.id,
    )!;
    await watchOk(bobSocket, plazaId);

    // 분수(3×4타일)는 놓은 칸(왼쪽 아래)에서 한 칸 위 가운데가 막혀 있다.
    const fountain = BUILTIN_MAPS['fountain-square'].objects.find(
      (o) => o.asset === 'builtin:fountain',
    )!;
    const insideFountain = {
      x: (fountain.x + 1) * TILE_SIZE + 8,
      y: (fountain.y - 1) * TILE_SIZE + 15,
    };
    for (const target of [{ x: start.x + 400, y: start.y }, insideFountain]) {
      const corrected = nextEvent(aliceSocket, SocketEvent.PlazaCorrected);
      move(aliceSocket, plazaId, target.x, target.y);
      expect(await corrected).toMatchObject({ plazaId, x: start.x, y: start.y });
    }
    await expectNoEvent(bobSocket, SocketEvent.PlazaMoved);
  });

  it('광장을 열지 않은 연결의 이동은 무시한다', async () => {
    const { alice, bob, plazaId } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const start = (await watchOk(bobSocket, plazaId)).occupants.find(
      (o) => o.user.id === alice.me.id,
    )!;
    move(aliceSocket, plazaId, start.x + 8, start.y);
    await expectNoEvent(bobSocket, SocketEvent.PlazaMoved);
  });
});

describe('광장 인원 변화', () => {
  it('멤버가 접속하면 나타나고, 모든 연결이 끊기면 사라진다', async () => {
    const { alice, bob, plazaId } = await setup();
    const aliceSocket = await connect(alice);
    await watchOk(aliceSocket, plazaId);

    const appeared = nextEvent(aliceSocket, SocketEvent.PlazaMember, (p) => p.userId === bob.me.id);
    const bobSocket = await connect(bob);
    const joined = await appeared;
    expect(joined.plazaId).toBe(plazaId);
    expect(joined.occupant?.user.id).toBe(bob.me.id);

    const gone = nextEvent(aliceSocket, SocketEvent.PlazaMember, (p) => p.userId === bob.me.id);
    bobSocket.disconnect();
    expect((await gone).occupant).toBeNull();
  });

  it('커뮤니티를 나가면 광장에서 사라지고, 더 이상 움직일 수 없다', async () => {
    const { alice, bob, community, plazaId } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    await watchOk(aliceSocket, plazaId);
    const bobStart = (await watchOk(bobSocket, plazaId)).occupants.find(
      (o) => o.user.id === bob.me.id,
    )!;

    const gone = nextEvent(aliceSocket, SocketEvent.PlazaMember, (p) => p.userId === bob.me.id);
    await bob.fetch(`/communities/${community.id}/leave`, post());
    expect((await gone).occupant).toBeNull();

    move(bobSocket, plazaId, bobStart.x + 8, bobStart.y);
    await expectNoEvent(aliceSocket, SocketEvent.PlazaMoved);
  });

  it('접속 중인 사람이 초대로 들어오면 광장에 바로 나타난다', async () => {
    const { alice, invite, plazaId } = await setup();
    const aliceSocket = await connect(alice);
    await watchOk(aliceSocket, plazaId);

    const carol = await loginUser(t);
    await connect(carol);
    const appeared = nextEvent(
      aliceSocket,
      SocketEvent.PlazaMember,
      (p) => p.userId === carol.me.id,
    );
    await carol.json(`/invites/${invite.code}/accept`, post());
    expect((await appeared).occupant?.user.id).toBe(carol.me.id);
  });
});
