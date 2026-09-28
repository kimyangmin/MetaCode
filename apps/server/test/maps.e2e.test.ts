import {
  type AssetDto,
  type CommunityMapDto,
  type CommunitySummary,
  type InviteInfo,
  type MapDefinition,
  type PlazaSnapshot,
  type SocketAck,
  SocketEvent,
  TILE_SIZE,
  encodePixels,
} from '@metacode/shared';
import { BUILTIN_MAPS, builtinAsset } from '@metacode/shared/builtin-assets';
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

const W = 12;
const H = 12;

/** 12×12 잔디 맵. wall 타일로 x = 6 세로줄을 막고, 스폰은 왼쪽 위 */
function smallMap(wall: string, overrides: Partial<MapDefinition> = {}): MapDefinition {
  const ground = new Uint8Array(W * H).fill(1);
  const overlay = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) overlay[y * W + 6] = 2;
  return {
    width: W,
    height: H,
    tiles: ['builtin:tt-0', wall],
    ground: encodePixels(ground),
    overlay: encodePixels(overlay),
    objects: [{ asset: 'builtin:bench', x: 2, y: 9 }],
    spawn: { x: 1, y: 1, w: 3, h: 3 },
    ...overrides,
  };
}

/** 소유자 alice(커뮤니티 벽 타일 하나), 멤버 bob, 멤버가 아닌 carol */
async function setup() {
  const [alice, bob, carol] = await Promise.all([loginUser(t), loginUser(t), loginUser(t)]);
  const community = await alice.json<CommunitySummary>(
    '/communities',
    send('POST', { name: '맵' }),
  );
  const invite = await alice.json<InviteInfo>(`/communities/${community.id}/invites`, send('POST'));
  await bob.json(`/invites/${invite.code}/accept`, send('POST'));
  const wall = await alice.json<AssetDto>(
    '/assets',
    send('POST', {
      communityId: community.id,
      manifest: { ...builtinAsset('builtin:tt-0')!, name: '벽', solid: true },
    }),
  );
  const plazaId = `community:${community.id}` as const;
  return { alice, bob, carol, community, wall, plazaId };
}

describe('커뮤니티 광장 맵', () => {
  it('저장하면 광장을 보던 사람에게 알리고, 다시 열면 새 맵과 쓴 에셋이 오고 모두 스폰에서 시작한다', async () => {
    const { alice, bob, community, wall, plazaId } = await setup();
    expect(await alice.json<CommunityMapDto>(`/communities/${community.id}/map`)).toEqual({
      definition: BUILTIN_MAPS['fountain-square'],
      custom: false,
    });

    const bobSocket = await connect(bob);
    await watch(bobSocket, plazaId);
    const changed = nextEvent(bobSocket, SocketEvent.PlazaMapChanged);
    const map = smallMap(wall.id);
    const saved = await alice.json<CommunityMapDto>(
      `/communities/${community.id}/map`,
      send('PUT', { definition: map }),
    );
    expect(saved).toEqual({ definition: map, custom: true });
    expect(await changed).toEqual({ plazaId });

    const snapshot = await watch(bobSocket, plazaId);
    expect(snapshot.definition).toEqual(map);
    expect(snapshot.assets).toEqual([{ id: wall.id, version: wall.updatedAt }]);
    const me = snapshot.occupants.find((o) => o.user.id === bob.me.id)!;
    expect(Math.floor(me.x / TILE_SIZE)).toBeLessThan(4);
    expect(Math.floor(me.y / TILE_SIZE)).toBeLessThan(4);
  });

  it('커뮤니티 에셋의 solid 타일로는 지나갈 수 없다', async () => {
    const { alice, community, wall, plazaId } = await setup();
    // 스폰은 벽(x = 6 줄) 바로 왼쪽 칸
    const map = smallMap(wall.id, { spawn: { x: 5, y: 1, w: 1, h: 3 } });
    await alice.fetch(`/communities/${community.id}/map`, send('PUT', { definition: map }));
    const socket = await connect(alice);
    const me = (await watch(socket, plazaId)).occupants[0]!;
    expect(Math.floor(me.x / TILE_SIZE)).toBe(5);

    // 오른쪽으로 2px은 갈 수 있지만, 6px 가면 발이 벽 칸에 걸린다.
    const move = (x: number) =>
      socket.emit(SocketEvent.PlazaMove, { plazaId, x, y: me.y, dir: 'right', moving: true });
    const accepted = expectNoEvent(socket, SocketEvent.PlazaCorrected);
    move(me.x + 2);
    await accepted;
    const corrected = nextEvent(socket, SocketEvent.PlazaCorrected);
    move(me.x + 6);
    expect(await corrected).toMatchObject({ x: me.x + 2, y: me.y });
  });

  it('소유자·관리자만 바꾸고, 멤버가 아니면 볼 수도 없다', async () => {
    const { bob, carol, community, wall } = await setup();
    const path = `/communities/${community.id}/map`;
    expect((await bob.fetch(path, send('PUT', { definition: smallMap(wall.id) }))).status).toBe(
      403,
    );
    expect((await bob.fetch(path, send('DELETE'))).status).toBe(403);
    expect((await bob.fetch(path)).status).toBe(200);
    expect((await carol.fetch(path)).status).toBe(404);
  });

  it('없거나 다른 커뮤니티의 에셋, 종류가 틀린 에셋, 설 곳 없는 스폰, 틀린 격자는 거절한다', async () => {
    const { alice, carol, community, wall } = await setup();
    const path = `/communities/${community.id}/map`;
    const other = await carol.json<CommunitySummary>('/communities', send('POST', { name: '남' }));
    const foreign = await carol.json<AssetDto>(
      '/assets',
      send('POST', { communityId: other.id, manifest: builtinAsset('builtin:tt-3')! }),
    );
    const bad: MapDefinition[] = [
      smallMap(foreign.id),
      smallMap('builtin:bench'),
      smallMap(wall.id, { spawn: { x: 6, y: 0, w: 1, h: 12 } }),
      smallMap(wall.id, { ground: encodePixels(new Uint8Array(5)) }),
    ];
    for (const definition of bad) {
      expect((await alice.fetch(path, send('PUT', { definition }))).status).toBe(400);
    }
  });

  it('맵에 쓴 에셋은 지울 수 없고, 고치면 광장에 알리며, 맵을 되돌리면 지울 수 있다', async () => {
    const { alice, bob, community, wall, plazaId } = await setup();
    const path = `/communities/${community.id}/map`;
    await alice.fetch(path, send('PUT', { definition: smallMap(wall.id) }));
    expect((await alice.fetch(`/assets/${wall.id}`, send('DELETE'))).status).toBe(409);

    const bobSocket = await connect(bob);
    await watch(bobSocket, plazaId);
    const changed = nextEvent(bobSocket, SocketEvent.PlazaMapChanged);
    await alice.json(
      `/assets/${wall.id}`,
      send('PUT', { manifest: { ...builtinAsset('builtin:tt-1')!, name: '벽 2', solid: true } }),
    );
    await changed;

    // 맵에 쓰지 않는 에셋을 고칠 때는 알리지 않는다.
    const unused = await alice.json<AssetDto>(
      '/assets',
      send('POST', { communityId: community.id, manifest: builtinAsset('builtin:tt-2')! }),
    );
    const quiet = expectNoEvent(bobSocket, SocketEvent.PlazaMapChanged);
    await alice.json(
      `/assets/${unused.id}`,
      send('PUT', { manifest: builtinAsset('builtin:tt-5')! }),
    );
    await quiet;

    const reset = nextEvent(bobSocket, SocketEvent.PlazaMapChanged);
    expect((await alice.json<CommunityMapDto>(path, send('DELETE'))).custom).toBe(false);
    await reset;
    expect((await watch(bobSocket, plazaId)).definition).toEqual(BUILTIN_MAPS['fountain-square']);
    expect((await alice.fetch(`/assets/${wall.id}`, send('DELETE'))).status).toBe(204);
  });
});
