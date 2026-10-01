import {
  type AssetDto,
  type AssetManifest,
  type CommunitySummary,
  type InviteInfo,
  SocketEvent,
  type UserDetail,
  type UserProfile,
} from '@metacode/shared';
import { builtinAsset } from '@metacode/shared/builtin-assets';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type ClientSocket,
  type TestApp,
  connectSocket,
  loginUser,
  nextEvent,
  startTestApp,
} from './harness.js';

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

let sockets: ClientSocket[] = [];

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

const character = (name: string): AssetManifest => ({
  ...builtinAsset('builtin:char-short')!,
  name,
});
/** 횡스크롤용 캐릭터: 내장 캐릭터에서 오른쪽만 남기고(왼쪽은 좌우 반전), 걷기로 점프를 채운다 */
const sideCharacter = (name: string): AssetManifest => {
  const base = builtinAsset('builtin:char-short')!;
  const animations = Object.fromEntries(
    Object.entries(base.animations).filter(([n]) => !/-(left|up|down)$/.test(n)),
  );
  return {
    ...base,
    name,
    style: 'SIDE_SCROLL',
    animations: { ...animations, 'jump-right': base.animations['walk-right']! },
  };
};
const tile = (name: string): AssetManifest => ({ ...builtinAsset('builtin:tt-0')!, name });
const object = (name: string): AssetManifest => ({ ...builtinAsset('builtin:bench')!, name });

/** 소유자 alice, 관리자 carol, 멤버 bob, 멤버가 아닌 dave */
async function setup() {
  const [alice, bob, carol, dave] = await Promise.all([
    loginUser(t),
    loginUser(t),
    loginUser(t),
    loginUser(t),
  ]);
  const community = await alice.json<CommunitySummary>(
    '/communities',
    send('POST', { name: '에셋' }),
  );
  const invite = await alice.json<InviteInfo>(`/communities/${community.id}/invites`, send('POST'));
  await bob.json(`/invites/${invite.code}/accept`, send('POST'));
  await carol.json(`/invites/${invite.code}/accept`, send('POST'));
  await alice.fetch(
    `/communities/${community.id}/members/${carol.me.id}/admin`,
    send('PUT', { admin: true }),
  );
  return { alice, bob, carol, dave, community };
}

describe('캐릭터 에셋', () => {
  it('만든 사람만 고치고 지우고, 로그인한 누구나 읽는다', async () => {
    const { bob, carol } = await setup();
    const created = await bob.json<AssetDto>(
      '/assets',
      send('POST', { manifest: character('내 캐릭터') }),
    );
    expect(created).toMatchObject({
      kind: 'character',
      name: '내 캐릭터',
      communityId: null,
      creatorId: bob.me.id,
    });
    expect((await bob.json<AssetDto[]>('/assets')).map((a) => a.id)).toEqual([created.id]);
    expect(await carol.json<AssetDto[]>('/assets')).toEqual([]);

    // 다른 사람도 읽을 수 있다 (광장에서 그 캐릭터를 그려야 하므로).
    expect((await carol.json<AssetDto>(`/assets/${created.id}`)).manifest.name).toBe('내 캐릭터');
    expect(
      (await carol.fetch(`/assets/${created.id}`, send('PUT', { manifest: character('뺏기') })))
        .status,
    ).toBe(403);
    expect((await carol.fetch(`/assets/${created.id}`, send('DELETE'))).status).toBe(403);

    const updated = await bob.json<AssetDto>(
      `/assets/${created.id}`,
      send('PUT', { manifest: character('새 이름') }),
    );
    expect(updated.name).toBe('새 이름');
    expect(updated.updatedAt > created.updatedAt).toBe(true);

    expect((await bob.fetch(`/assets/${created.id}`, send('DELETE'))).status).toBe(204);
    expect((await bob.fetch(`/assets/${created.id}`)).status).toBe(404);
  });

  it('필수 애니메이션을 다 그리지 않은 캐릭터는 저장하지 않는다', async () => {
    const { bob } = await setup();
    const base = character('덜 그림');
    const animations = Object.fromEntries(
      Object.entries(base.animations).filter(([name]) => name !== 'walk-up'),
    );
    const res = await bob.fetch('/assets', send('POST', { manifest: { ...base, animations } }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('걷기 (위)');
  });

  it('캐릭터는 커뮤니티에, 타일·오브젝트는 커뮤니티 밖에 만들 수 없고 종류는 바꿀 수 없다', async () => {
    const { alice, community } = await setup();
    const inCommunity = await alice.fetch(
      '/assets',
      send('POST', { communityId: community.id, manifest: character('커뮤니티 캐릭터') }),
    );
    expect(inCommunity.status).toBe(400);
    expect((await alice.fetch('/assets', send('POST', { manifest: tile('떠돌이') }))).status).toBe(
      400,
    );

    const mine = await alice.json<AssetDto>('/assets', send('POST', { manifest: character('나') }));
    expect(
      (await alice.fetch(`/assets/${mine.id}`, send('PUT', { manifest: tile('타일로') }))).status,
    ).toBe(400);
  });
});

describe('커뮤니티 타일·오브젝트', () => {
  it('소유자·관리자만 만들고 고치며, 멤버는 읽기만, 멤버가 아니면 있는지도 모른다', async () => {
    const { alice, bob, carol, dave, community } = await setup();
    const byOwner = await alice.json<AssetDto>(
      '/assets',
      send('POST', { communityId: community.id, manifest: tile('잔디 2') }),
    );
    const byAdmin = await carol.json<AssetDto>(
      '/assets',
      send('POST', { communityId: community.id, manifest: object('의자') }),
    );
    expect(byAdmin).toMatchObject({ kind: 'object', communityId: community.id });

    const byMember = await bob.fetch(
      '/assets',
      send('POST', { communityId: community.id, manifest: tile('몰래') }),
    );
    expect(byMember.status).toBe(403);

    const listed = await bob.json<AssetDto[]>(`/assets?communityId=${community.id}`);
    expect(listed.map((a) => a.id)).toEqual([byOwner.id, byAdmin.id]);
    expect((await bob.json<AssetDto>(`/assets/${byOwner.id}`)).name).toBe('잔디 2');
    expect(
      (await bob.fetch(`/assets/${byOwner.id}`, send('PUT', { manifest: tile('고침') }))).status,
    ).toBe(403);

    // 관리자는 다른 사람이 만든 커뮤니티 에셋도 고친다.
    const edited = await carol.json<AssetDto>(
      `/assets/${byOwner.id}`,
      send('PUT', { manifest: { ...tile('잔디 3'), solid: true } }),
    );
    expect(edited.manifest.solid).toBe(true);

    expect((await dave.fetch(`/assets?communityId=${community.id}`)).status).toBe(404);
    expect((await dave.fetch(`/assets/${byOwner.id}`)).status).toBe(404);
    expect((await dave.fetch(`/assets/${byOwner.id}`, send('DELETE'))).status).toBe(404);

    expect((await alice.fetch(`/assets/${byAdmin.id}`, send('DELETE'))).status).toBe(204);
    expect((await bob.json<AssetDto[]>(`/assets?communityId=${community.id}`)).length).toBe(1);
  });

  it('커뮤니티를 지우면 그 에셋도 지워진다', async () => {
    const { alice, community } = await setup();
    const asset = await alice.json<AssetDto>(
      '/assets',
      send('POST', { communityId: community.id, manifest: tile('사라질 타일') }),
    );
    expect((await alice.fetch(`/communities/${community.id}`, send('DELETE'))).status).toBe(204);
    expect((await alice.fetch(`/assets/${asset.id}`)).status).toBe(404);
  });
});

describe('캐릭터 고르기', () => {
  it('기본 캐릭터를 색과 함께 고르면 같은 커뮤니티 사람에게 알리고, null이면 기본으로 돌아간다', async () => {
    const { alice, bob } = await setup();
    const bobSocket = await connectSocket(t, bob);
    sockets.push(bobSocket);
    expect((await alice.json<UserDetail>('/users/me')).character).toBeNull();

    const updated = nextEvent(bobSocket, SocketEvent.UserUpdated);
    const choice = { asset: 'builtin:char-long', colors: { shirt: '#3f8fdb' } };
    const me = await alice.json<UserDetail>(
      '/users/me/character',
      send('PUT', { character: choice }),
    );
    expect(me.character).toEqual(choice);
    expect(((await updated) as UserProfile).character).toEqual(choice);

    const reset = await alice.json<UserDetail>(
      '/users/me/character',
      send('PUT', { character: null }),
    );
    expect(reset.character).toBeNull();

    for (const bad of [
      { asset: 'builtin:tt-0', colors: {} },
      { asset: 'builtin:char-short', colors: { shirt: 'blue' } },
    ]) {
      expect(
        (await alice.fetch('/users/me/character', send('PUT', { character: bad }))).status,
      ).toBe(400);
    }
  });

  it('직접 그린 캐릭터는 만든 사람만 고르고, 고치면 version이 바뀌고 지우면 기본으로 돌아간다', async () => {
    const { alice, bob } = await setup();
    const mine = await alice.json<AssetDto>('/assets', send('POST', { manifest: character('나') }));
    expect(
      (
        await bob.fetch(
          '/users/me/character',
          send('PUT', { character: { asset: mine.id, colors: {} } }),
        )
      ).status,
    ).toBe(400);

    const chosen = await alice.json<UserDetail>(
      '/users/me/character',
      send('PUT', { character: { asset: mine.id, colors: {} } }),
    );
    expect(chosen.character).toEqual({ asset: mine.id, colors: {}, version: mine.updatedAt });

    const bobSocket = await connectSocket(t, bob);
    sockets.push(bobSocket);
    const edited = nextEvent(bobSocket, SocketEvent.UserUpdated);
    const saved = await alice.json<AssetDto>(
      `/assets/${mine.id}`,
      send('PUT', { manifest: character('나 2') }),
    );
    expect(((await edited) as UserProfile).character?.version).toBe(saved.updatedAt);

    const removed = nextEvent(bobSocket, SocketEvent.UserUpdated);
    await alice.fetch(`/assets/${mine.id}`, send('DELETE'));
    expect(((await removed) as UserProfile).character).toBeNull();
    expect((await alice.json<UserDetail>('/users/me')).character).toBeNull();
  });

  it('횡스크롤 광장의 캐릭터는 따로 고르고(없으면 탑다운과 같음), 쓰던 에셋을 고치거나 지우면 함께 바뀐다', async () => {
    const { alice } = await setup();
    const top = { asset: 'builtin:char-long', colors: { shirt: '#3f8fdb' } };
    await alice.json('/users/me/character', send('PUT', { character: top }));
    expect((await alice.json<UserDetail>('/users/me')).sideCharacter).toBeNull();

    const mine = await alice.json<AssetDto>('/assets', send('POST', { manifest: character('옆') }));
    const side = await alice.json<UserDetail>(
      '/users/me/character',
      send('PUT', { character: { asset: mine.id, colors: {} }, style: 'SIDE_SCROLL' }),
    );
    expect(side.character).toEqual(top);
    expect(side.sideCharacter).toEqual({ asset: mine.id, colors: {}, version: mine.updatedAt });

    const saved = await alice.json<AssetDto>(
      `/assets/${mine.id}`,
      send('PUT', { manifest: character('옆 2') }),
    );
    const edited = await alice.json<UserDetail>('/users/me');
    expect(edited.sideCharacter?.version).toBe(saved.updatedAt);
    expect(edited.character).toEqual(top);

    await alice.fetch(`/assets/${mine.id}`, send('DELETE'));
    const removed = await alice.json<UserDetail>('/users/me');
    expect(removed.sideCharacter).toBeNull();
    expect(removed.character).toEqual(top);

    const same = await alice.json<UserDetail>(
      '/users/me/character',
      send('PUT', { character: null, style: 'SIDE_SCROLL' }),
    );
    expect(same.sideCharacter).toBeNull();
    expect(
      (await alice.fetch('/users/me/character', send('PUT', { character: null, style: 'ISO' })))
        .status,
    ).toBe(400);
  });

  it('횡스크롤용 캐릭터는 횡스크롤 광장에서만 고르고, 탑다운에서 쓰는 캐릭터는 횡스크롤용으로 못 바꾼다', async () => {
    const { alice } = await setup();
    // 점프가 빠진 횡스크롤용 캐릭터는 저장하지 않는다
    const noJump = sideCharacter('점프 없음');
    delete noJump.animations['jump-right'];
    const rejected = await alice.fetch('/assets', send('POST', { manifest: noJump }));
    expect(rejected.status).toBe(400);

    const side = await alice.json<AssetDto>(
      '/assets',
      send('POST', { manifest: sideCharacter('옆') }),
    );
    const choice = { character: { asset: side.id, colors: {} } };
    expect((await alice.fetch('/users/me/character', send('PUT', choice))).status).toBe(400);
    const picked = await alice.json<UserDetail>(
      '/users/me/character',
      send('PUT', { ...choice, style: 'SIDE_SCROLL' }),
    );
    expect(picked.sideCharacter?.asset).toBe(side.id);

    // 탑다운 캐릭터로 쓰는 에셋은 횡스크롤용으로 바꿀 수 없고, 다른 캐릭터로 바꾼 뒤에는 된다
    const top = await alice.json<AssetDto>('/assets', send('POST', { manifest: character('위') }));
    await alice.json(
      '/users/me/character',
      send('PUT', { character: { asset: top.id, colors: {} } }),
    );
    const toSide = send('PUT', { manifest: sideCharacter('위') });
    expect((await alice.fetch(`/assets/${top.id}`, toSide)).status).toBe(409);
    await alice.json('/users/me/character', send('PUT', { character: null }));
    expect(
      (await alice.fetch(`/assets/${top.id}`, send('PUT', { manifest: sideCharacter('위') })))
        .status,
    ).toBe(200);
  });
});
