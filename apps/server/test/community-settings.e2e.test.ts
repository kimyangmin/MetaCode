import {
  type AvatarUploadTicket,
  type CommunityImageKind,
  type CommunitySummary,
  type InviteInfo,
  SocketEvent,
} from '@metacode/shared';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type ClientSocket,
  type TestApp,
  type TestUser,
  connectSocket,
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

/** 이미지 주소는 PUBLIC_SERVER_URL 기준이라, 테스트 서버에서는 경로만 쓴다 */
const pathOf = (url: string) => new URL(url).pathname;

const png = (color: string) =>
  sharp({ create: { width: 600, height: 300, channels: 3, background: color } })
    .png()
    .toBuffer();

async function setup() {
  const owner = await loginUser(t);
  const member = await loginUser(t);
  const community = await owner.json<CommunitySummary>(
    '/communities',
    json('POST', { name: '마을' }),
  );
  const invite = await owner.json<InviteInfo>(`/communities/${community.id}/invites`, json('POST'));
  await member.json(`/invites/${invite.code}/accept`, json('POST'));
  return { owner, member, community, invite };
}

async function upload(
  user: TestUser,
  communityId: string,
  kind: CommunityImageKind,
  body: Uint8Array,
  crop?: { x: number; y: number; width: number; height: number },
): Promise<Response> {
  const res = await user.fetch(
    `/communities/${communityId}/images/${kind}/upload`,
    json('POST', { size: body.byteLength }),
  );
  if (!res.ok) return res;
  const ticket = (await res.json()) as AvatarUploadTicket;
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body });
  expect(put.ok).toBe(true);
  return user.fetch(
    `/communities/${communityId}/images/${kind}`,
    crop ? json('PUT', { crop }) : { method: 'PUT' },
  );
}

async function summaryOf(user: TestUser, communityId: string) {
  const list = await user.json<CommunitySummary[]>('/communities');
  return list.find((c) => c.id === communityId)!;
}

describe('커뮤니티 설정', () => {
  it('소유자·관리자가 이름을 바꾸면 멤버에게 community:updated로 알린다', async () => {
    const { owner, member, community } = await setup();
    const socket = sockets[sockets.push(await connectSocket(t, member)) - 1]!;

    const forbidden = await member.fetch(
      `/communities/${community.id}`,
      json('PATCH', { name: '몰래' }),
    );
    expect(forbidden.status).toBe(403);

    const updated = nextEvent(socket, SocketEvent.CommunityUpdated);
    const res = await owner.fetch(
      `/communities/${community.id}`,
      json('PATCH', { name: '새 마을' }),
    );
    expect(res.status).toBe(204);
    expect(await updated).toEqual({ communityId: community.id });
    expect((await summaryOf(member, community.id)).name).toBe('새 마을');

    const empty = await owner.fetch(`/communities/${community.id}`, json('PATCH', { name: ' ' }));
    expect(empty.status).toBe(400);
  });

  it('고른 곳(crop)을 종류별 크기로 잘라 쓴다', async () => {
    const { owner, community } = await setup();
    // 위 절반 초록, 아래 절반 파랑인 사진에서 아래쪽 16:9를 고른다.
    const image = await sharp({
      create: { width: 640, height: 720, channels: 3, background: '#00ff00' },
    })
      .composite([
        {
          input: { create: { width: 640, height: 360, channels: 3, background: '#0000ff' } },
          left: 0,
          top: 360,
        },
      ])
      .png()
      .toBuffer();
    const crop = { x: 0, y: 0.5, width: 1, height: 0.5 };
    expect((await upload(owner, community.id, 'banner', image, crop)).status).toBe(204);
    const { bannerUrl } = await summaryOf(owner, community.id);
    const file = await t.fetch(pathOf(bannerUrl!));
    const { data, info } = await sharp(Buffer.from(await file.arrayBuffer()))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([960, 540]);
    const i = (270 * info.width + 480) * info.channels;
    expect(data[i + 2]).toBeGreaterThan(200);
    expect(data[i + 1]).toBeLessThan(60);
  });

  it('아이콘·배너를 종류별 크기로 바꿔 쓰고, 초대 화면에도 아이콘이 보인다', async () => {
    const { owner, member, community, invite } = await setup();
    expect(await summaryOf(owner, community.id)).toMatchObject({ iconUrl: null, bannerUrl: null });

    expect((await upload(member, community.id, 'icon', await png('#ff0000'))).status).toBe(403);
    expect((await upload(owner, community.id, 'icon', await png('#ff0000'))).status).toBe(204);
    expect((await upload(owner, community.id, 'banner', await png('#00ff00'))).status).toBe(204);

    const summary = await summaryOf(member, community.id);
    expect(summary.iconUrl).toMatch(
      new RegExp(`/community-images/${community.id}/icon-[0-9a-f-]{36}\\.webp$`),
    );
    const sizes = [];
    for (const url of [summary.iconUrl!, summary.bannerUrl!]) {
      // 인증 없이 받을 수 있고, 오래 캐시한다.
      const file = await t.fetch(pathOf(url));
      expect(file.status).toBe(200);
      expect(file.headers.get('cache-control')).toContain('immutable');
      const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
      sizes.push([meta.width, meta.height]);
    }
    expect(sizes).toEqual([
      [256, 256],
      [960, 540],
    ]);

    const stranger = await loginUser(t);
    const info = await stranger.json<InviteInfo>(`/invites/${invite.code}`);
    expect(info.communityIconUrl).toBe(summary.iconUrl);

    // 바꾸면 이전 파일은 지우고, 지우기도 된다.
    expect((await upload(owner, community.id, 'icon', await png('#0000ff'))).status).toBe(204);
    expect((await t.fetch(pathOf(summary.iconUrl!))).status).toBe(404);
    const removed = await owner.fetch(`/communities/${community.id}/images/banner`, json('DELETE'));
    expect(removed.status).toBe(204);
    expect((await summaryOf(owner, community.id)).bannerUrl).toBeNull();
    expect((await t.fetch(pathOf(summary.bannerUrl!))).status).toBe(404);
  });

  it('이미지가 아니거나 종류가 틀리면 거절한다', async () => {
    const { owner, community } = await setup();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await upload(owner, community.id, 'icon', svg)).status).toBe(400);
    const wrong = await owner.fetch(
      `/communities/${community.id}/images/cover/upload`,
      json('POST', { size: 10 }),
    );
    expect(wrong.status).toBe(400);
  });

  it('커뮤니티를 지우면 올린 이미지도 지운다', async () => {
    const { owner, community } = await setup();
    await upload(owner, community.id, 'icon', await png('#ff0000'));
    const { iconUrl } = await summaryOf(owner, community.id);
    const res = await owner.fetch(`/communities/${community.id}`, json('DELETE'));
    expect(res.status).toBe(204);
    expect((await t.fetch(pathOf(iconUrl!))).status).toBe(404);
  });
});
