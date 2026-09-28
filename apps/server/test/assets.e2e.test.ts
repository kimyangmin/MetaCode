import {
  type AssetDto,
  type AssetManifest,
  type CommunitySummary,
  type InviteInfo,
} from '@metacode/shared';
import { builtinAsset } from '@metacode/shared/builtin-assets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApp, loginUser, startTestApp } from './harness.js';

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
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
