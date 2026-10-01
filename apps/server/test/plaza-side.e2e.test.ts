import {
  type CommunityMapDto,
  type CommunitySummary,
  type InviteInfo,
  type PlazaId,
  type PlazaSnapshot,
  type SocketAck,
  SocketEvent,
  TILE_SIZE,
  encodePixels,
  isGrounded,
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

const send = (method: string, body?: unknown): RequestInit => ({
  method,
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

/** 횡스크롤 커뮤니티를 만든 alice와 멤버 bob */
async function setup(plazaStyle?: string) {
  const [alice, bob] = await Promise.all([loginUser(t), loginUser(t)]);
  const community = await alice.json<CommunitySummary>(
    '/communities',
    send('POST', { name: '옆 광장', ...(plazaStyle ? { plazaStyle } : {}) }),
  );
  const invite = await alice.json<InviteInfo>(`/communities/${community.id}/invites`, send('POST'));
  await bob.json(`/invites/${invite.code}/accept`, send('POST'));
  const plazaId: PlazaId = `community:${community.id}`;
  return { alice, bob, community, plazaId };
}

describe('광장 방식 고르기', () => {
  it('만들 때 고르지 않으면 탑다운, 고르면 그 방식이 커뮤니티 정보에 실린다', async () => {
    const plain = await setup();
    expect(plain.community.plazaStyle).toBe('TOP_DOWN');
    const side = await setup('SIDE_SCROLL');
    expect(side.community.plazaStyle).toBe('SIDE_SCROLL');
    const listed = await side.bob.json<CommunitySummary[]>('/communities');
    expect(listed.find((c) => c.id === side.community.id)?.plazaStyle).toBe('SIDE_SCROLL');
  });

  it('모르는 방식은 거절한다', async () => {
    const alice = await loginUser(t);
    const res = await alice.fetch(
      '/communities',
      send('POST', { name: 'x', plazaStyle: 'ISOMETRIC' }),
    );
    expect(res.status).toBe(400);
  });

  it('횡스크롤 광장은 옆에서 본 분수 광장이고, 사람들은 땅 위에 선다', async () => {
    const { alice, bob, plazaId } = await setup('SIDE_SCROLL');
    const socket = await connect(alice);
    await connect(bob);
    const snapshot = await watch(socket, plazaId);
    expect(snapshot.map).toBe('fountain-side');
    expect(snapshot.definition).toEqual(BUILTIN_MAPS['fountain-side']);
    expect(snapshot.occupants).toHaveLength(2);
    for (const o of snapshot.occupants) {
      expect(isGrounded(BUILTIN_LAYOUTS['fountain-side'], o.x, o.y)).toBe(true);
    }
  });
});

describe('횡스크롤 이동', () => {
  it('걷기와 점프는 받아들이고, 점프 높이보다 높이 날면 되돌린다', async () => {
    const { alice, bob, plazaId } = await setup('SIDE_SCROLL');
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const start = (await watch(aliceSocket, plazaId)).occupants.find(
      (o) => o.user.id === alice.me.id,
    )!;
    await watch(bobSocket, plazaId);
    const move = (x: number, y: number, moving = true) =>
      aliceSocket.emit(SocketEvent.PlazaMove, { plazaId, x, y, dir: 'right', moving });

    await sleep(150);
    const walked = nextEvent(bobSocket, SocketEvent.PlazaMoved);
    move(start.x + 8, start.y);
    expect(await walked).toMatchObject({ x: start.x + 8, y: start.y });

    await sleep(150);
    const jumped = nextEvent(bobSocket, SocketEvent.PlazaMoved);
    move(start.x + 12, start.y - 40);
    expect(await jumped).toMatchObject({ y: start.y - 40 });

    // 공중에서 더 오르기: 마지막으로 딛은 땅보다 점프 높이 이상 높다
    await sleep(150);
    const corrected = nextEvent(aliceSocket, SocketEvent.PlazaCorrected);
    move(start.x + 12, start.y - 90);
    expect(await corrected).toMatchObject({ plazaId, x: start.x + 12, y: start.y - 40 });

    // 땅에 내려앉으면 다시 뛸 수 있다
    await sleep(150);
    const landed = nextEvent(bobSocket, SocketEvent.PlazaMoved);
    move(start.x + 14, start.y, false);
    expect(await landed).toMatchObject({ y: start.y });
    await sleep(150);
    const again = nextEvent(bobSocket, SocketEvent.PlazaMoved);
    move(start.x + 16, start.y - 50);
    expect(await again).toMatchObject({ y: start.y - 50 });
  });

  it('벽(막힌 칸)을 뚫고 가면 되돌린다', async () => {
    const { alice, plazaId } = await setup('SIDE_SCROLL');
    const socket = await connect(alice);
    const me = (await watch(socket, plazaId)).occupants[0]!;
    await sleep(150);
    const corrected = nextEvent(socket, SocketEvent.PlazaCorrected);
    // 땅 속으로
    socket.emit(SocketEvent.PlazaMove, {
      plazaId,
      x: me.x,
      y: me.y + 2 * TILE_SIZE,
      dir: 'down',
      moving: true,
    });
    expect(await corrected).toMatchObject({ x: me.x, y: me.y });
  });
});

describe('광장 방식 바꾸기', () => {
  it('소유자가 바꾸면 커뮤니티 정보와 광장이 바뀐다 (멤버는 못 바꾼다)', async () => {
    const { alice, bob, community, plazaId } = await setup();
    const bobSocket = await connect(bob);
    await watch(bobSocket, plazaId);

    const denied = await bob.fetch(
      `/communities/${community.id}`,
      send('PATCH', { plazaStyle: 'SIDE_SCROLL' }),
    );
    expect(denied.status).toBe(403);

    const updated = nextEvent(bobSocket, SocketEvent.CommunityUpdated);
    const mapChanged = nextEvent(bobSocket, SocketEvent.PlazaMapChanged);
    const res = await alice.fetch(
      `/communities/${community.id}`,
      send('PATCH', { plazaStyle: 'SIDE_SCROLL' }),
    );
    expect(res.status).toBe(204);
    expect(await updated).toEqual({ communityId: community.id });
    expect(await mapChanged).toEqual({ plazaId });
    const snapshot = await watch(bobSocket, plazaId);
    expect(snapshot.map).toBe('fountain-side');
    const listed = await bob.json<CommunitySummary[]>('/communities');
    expect(listed.find((c) => c.id === community.id)?.plazaStyle).toBe('SIDE_SCROLL');
  });

  it('이름만 바꾸면 광장은 그대로다', async () => {
    const { alice, bob, community, plazaId } = await setup();
    const bobSocket = await connect(bob);
    await watch(bobSocket, plazaId);
    const res = await alice.fetch(
      `/communities/${community.id}`,
      send('PATCH', { name: '새 이름' }),
    );
    expect(res.status).toBe(204);
    await expectNoEvent(bobSocket, SocketEvent.PlazaMapChanged);
    expect((await alice.fetch(`/communities/${community.id}`, send('PATCH', {}))).status).toBe(400);
  });

  it('꾸민 맵은 다른 방식에서는 쓰지 않고, 되돌리면 다시 쓴다. 다른 방식의 맵은 저장할 수 없다', async () => {
    const { alice, community } = await setup();
    const path = `/communities/${community.id}/map`;
    const width = 12;
    const cells = new Uint8Array(width * width);
    const topDown = {
      width,
      height: width,
      tiles: ['builtin:tt-0'],
      ground: encodePixels(cells.fill(1)),
      overlay: encodePixels(new Uint8Array(width * width)),
      objects: [],
      spawn: { x: 1, y: 1, w: 2, h: 2 },
    };
    await alice.json<CommunityMapDto>(path, send('PUT', { definition: topDown }));

    await alice.fetch(`/communities/${community.id}`, send('PATCH', { plazaStyle: 'SIDE_SCROLL' }));
    expect(await alice.json<CommunityMapDto>(path)).toEqual({
      definition: BUILTIN_MAPS['fountain-side'],
      custom: false,
    });
    const wrong = await alice.fetch(path, send('PUT', { definition: topDown }));
    expect(wrong.status).toBe(400);

    await alice.fetch(`/communities/${community.id}`, send('PATCH', { plazaStyle: 'TOP_DOWN' }));
    expect(await alice.json<CommunityMapDto>(path)).toEqual({ definition: topDown, custom: true });
  });
});
