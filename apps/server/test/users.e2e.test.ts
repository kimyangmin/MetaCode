import {
  type AvatarUploadTicket,
  type CommunitySummary,
  type InviteInfo,
  SocketEvent,
  type UserDetail,
} from '@metacode/shared';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  type ClientSocket,
  type TestApp,
  type TestUser,
  connectSocket,
  expectNoEvent,
  loginUser,
  makeGithubUser,
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

/** 프로필 사진 주소는 PUBLIC_SERVER_URL 기준이라, 테스트 서버에서는 경로만 쓴다 */
const avatarPath = (url: string) => new URL(url).pathname;

async function uploadAvatar(
  user: TestUser,
  body: Uint8Array,
  apply?: { crop: { x: number; y: number; width: number; height: number } },
): Promise<Response> {
  const ticket = await user.json<AvatarUploadTicket>(
    '/users/me/avatar/upload',
    json('POST', { size: body.byteLength }),
  );
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body });
  expect(put.ok).toBe(true);
  return user.fetch('/users/me/avatar', apply ? json('PUT', apply) : { method: 'PUT' });
}

/** 왼쪽 절반은 빨강, 오른쪽 절반은 파랑인 600×300 사진 */
const halves = () =>
  sharp({ create: { width: 600, height: 300, channels: 3, background: '#ff0000' } })
    .composite([
      {
        input: { create: { width: 300, height: 300, channels: 3, background: '#0000ff' } },
        left: 300,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

/** 받은 사진의 가운데 픽셀 색 [r, g, b] */
async function centerColor(url: string): Promise<number[]> {
  const file = await t.fetch(avatarPath(url));
  const { data, info } = await sharp(Buffer.from(await file.arrayBuffer()))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

/** 세 장면(빨강·초록·파랑)이 바뀌는 움직이는 GIF */
const animatedGif = async () => {
  const frames = await Promise.all(
    ['#ff0000', '#00ff00', '#0000ff'].map((color) =>
      sharp({ create: { width: 120, height: 60, channels: 3, background: color } })
        .png()
        .toBuffer(),
    ),
  );
  return sharp(frames, { join: { animated: true } })
    .gif({ delay: [100, 100, 100], loop: 0 })
    .toBuffer();
};

/** 받은 WebP의 장면 수 */
async function framesOf(url: string): Promise<number> {
  const file = await t.fetch(avatarPath(url));
  expect(file.status).toBe(200);
  return (
    (await sharp(Buffer.from(await file.arrayBuffer()), { animated: true }).metadata()).pages ?? 1
  );
}

const isBlue = ([r, g, b]: number[]) => b! > 200 && r! < 60 && g! < 60;
const isRed = ([r, g, b]: number[]) => r! > 200 && b! < 60 && g! < 60;

const png = (color: string) =>
  sharp({ create: { width: 600, height: 300, channels: 3, background: color } })
    .png()
    .toBuffer();

describe('프로필', () => {
  it('닉네임과 자기소개를 바꾸고, 비우면 기본값으로 돌아간다', async () => {
    const user = await loginUser(t);
    expect(user.me.displayName).toBeNull();

    const updated = await user.json<UserDetail>(
      '/users/me',
      json('PATCH', { nickname: '  양민  ', bio: '안녕하세요' }),
    );
    expect(updated).toMatchObject({ displayName: '양민', bio: '안녕하세요', customAvatar: false });

    // 보내지 않은 항목은 그대로 둔다.
    const onlyBio = await user.json<UserDetail>('/users/me', json('PATCH', { bio: '' }));
    expect(onlyBio).toMatchObject({ displayName: '양민', bio: null });

    const reset = await user.json<UserDetail>('/users/me', json('PATCH', { nickname: '' }));
    expect(reset.displayName).toBeNull();

    const tooLong = await user.fetch('/users/me', json('PATCH', { nickname: 'x'.repeat(33) }));
    expect(tooLong.status).toBe(400);
  });

  it('GitHub로 다시 로그인하면 GitHub 정보만 맞추고 닉네임과 자기소개는 그대로 둔다', async () => {
    const github = makeGithubUser();
    const user = await loginUser(t, github);
    await user.json('/users/me', json('PATCH', { nickname: '닉네임', bio: '소개' }));

    const again = await loginUser(t, { ...github, name: '바뀐 GitHub 이름', login: 'renamed' });
    expect(again.me.id).toBe(user.me.id);
    expect(await again.json<UserDetail>('/users/me')).toMatchObject({
      username: 'renamed',
      displayName: '닉네임',
      bio: '소개',
    });
  });

  it('다른 사람의 프로필(자기소개 포함)을 볼 수 있다', async () => {
    const alice = await loginUser(t);
    const bob = await loginUser(t);
    await alice.json('/users/me', json('PATCH', { bio: '앨리스입니다' }));
    const seen = await bob.json<UserDetail>(`/users/${alice.me.id}`);
    expect(seen).toMatchObject({ id: alice.me.id, bio: '앨리스입니다' });
  });

  it('닉네임을 바꾸면 같은 커뮤니티 멤버와 본인에게 알리고, 모르는 사람에게는 알리지 않는다', async () => {
    const alice = await loginUser(t);
    const bob = await loginUser(t);
    const stranger = await loginUser(t);
    const community = await alice.json<CommunitySummary>(
      '/communities',
      json('POST', { name: '알림' }),
    );
    const invite = await alice.json<InviteInfo>(
      `/communities/${community.id}/invites`,
      json('POST'),
    );
    await bob.json(`/invites/${invite.code}/accept`, json('POST'));
    const [aliceSocket, bobSocket, strangerSocket] = await Promise.all([
      connect(alice),
      connect(bob),
      connect(stranger),
    ]);

    const toBob = nextEvent(bobSocket, SocketEvent.UserUpdated, (u) => u.id === alice.me.id);
    const toSelf = nextEvent(aliceSocket, SocketEvent.UserUpdated, (u) => u.id === alice.me.id);
    const notStranger = expectNoEvent(strangerSocket, SocketEvent.UserUpdated);
    await alice.json('/users/me', json('PATCH', { nickname: '새 이름' }));
    expect((await toBob).displayName).toBe('새 이름');
    expect((await toSelf).displayName).toBe('새 이름');
    await notStranger;
  });
});

describe('프로필 사진', () => {
  it('올린 이미지를 정사각형 WebP로 바꿔 쓰고, 바꾸면 이전 사진은 지운다', async () => {
    const user = await loginUser(t);
    const githubAvatar = user.me.avatarUrl;

    const first = await uploadAvatar(user, await png('#ff0000'));
    expect(first.status).toBe(200);
    const applied = (await first.json()) as UserDetail;
    expect(applied.customAvatar).toBe(true);
    expect(applied.avatarUrl).toMatch(new RegExp(`/avatars/${user.me.id}/[0-9a-f-]{36}\\.webp$`));

    // 인증 없이 받을 수 있고, 오래 캐시한다.
    const file = await t.fetch(avatarPath(applied.avatarUrl));
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/webp');
    expect(file.headers.get('cache-control')).toContain('immutable');
    const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);

    const second = (await (await uploadAvatar(user, await png('#0000ff'))).json()) as UserDetail;
    expect(second.avatarUrl).not.toBe(applied.avatarUrl);
    expect((await t.fetch(avatarPath(applied.avatarUrl))).status).toBe(404);

    // GitHub 사진으로 돌아가면 올린 사진도 지운다.
    const reset = await user.json<UserDetail>('/users/me/avatar', json('DELETE'));
    expect(reset).toMatchObject({ customAvatar: false, avatarUrl: githubAvatar });
    expect((await t.fetch(avatarPath(second.avatarUrl))).status).toBe(404);
  });

  it('고른 곳(crop)을 잘라 쓰고, 고르지 않으면 가운데를 자른다', async () => {
    const user = await loginUser(t);
    const right = (await (
      await uploadAvatar(user, await halves(), {
        crop: { x: 0.5, y: 0, width: 0.5, height: 1 },
      })
    ).json()) as UserDetail;
    expect(isBlue(await centerColor(right.avatarUrl))).toBe(true);

    const left = (await (
      await uploadAvatar(user, await halves(), {
        crop: { x: 0, y: 0, width: 0.5, height: 1 },
      })
    ).json()) as UserDetail;
    expect(isRed(await centerColor(left.avatarUrl))).toBe(true);

    // 사진 밖을 고르면 거절한다.
    const outside = await uploadAvatar(user, await halves(), {
      crop: { x: 0.8, y: 0, width: 0.5, height: 1 },
    });
    expect(outside.status).toBe(400);
  });

  it('EXIF로 돌려 찍은 사진은 보이는 방향 기준으로 자른다', async () => {
    const user = await loginUser(t);
    // 저장은 300×600(위 빨강, 아래 파랑)이고 EXIF 6(시계 방향 90도)이라, 보이는 모습은
    // 600×300에 왼쪽 파랑, 오른쪽 빨강이다.
    const stored = await sharp({
      create: { width: 300, height: 600, channels: 3, background: '#ff0000' },
    })
      .composite([
        {
          input: { create: { width: 300, height: 300, channels: 3, background: '#0000ff' } },
          left: 0,
          top: 300,
        },
      ])
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const applied = (await (
      await uploadAvatar(user, stored, { crop: { x: 0, y: 0, width: 0.5, height: 1 } })
    ).json()) as UserDetail;
    expect(isBlue(await centerColor(applied.avatarUrl))).toBe(true);
  });

  it('움직이는 사진(GIF)은 멈춘 사진과 움직이는 사진을 함께 만들고, 되돌리면 둘 다 지운다', async () => {
    const user = await loginUser(t);
    const res = await uploadAvatar(user, await animatedGif(), {
      crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
    });
    expect(res.status).toBe(200);
    const applied = (await res.json()) as UserDetail;
    expect(applied.avatarAnimatedUrl).toMatch(/-animated\.webp$/);
    expect(await framesOf(applied.avatarUrl)).toBe(1);
    expect(await framesOf(applied.avatarAnimatedUrl!)).toBe(3);

    // 멈춘 사진을 올리면 움직이는 사진은 없고, 이전 움직이는 사진도 지운다.
    const still = (await (await uploadAvatar(user, await png('#ff0000'))).json()) as UserDetail;
    expect(still.avatarAnimatedUrl).toBeNull();
    expect((await t.fetch(avatarPath(applied.avatarAnimatedUrl!))).status).toBe(404);

    const gif = (await (await uploadAvatar(user, await animatedGif())).json()) as UserDetail;
    await user.json<UserDetail>('/users/me/avatar', json('DELETE'));
    expect((await t.fetch(avatarPath(gif.avatarAnimatedUrl!))).status).toBe(404);
    expect((await t.fetch(avatarPath(gif.avatarUrl))).status).toBe(404);
  });

  it('이미지가 아니면 거절한다 (SVG 포함)', async () => {
    const user = await loginUser(t);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const res = await uploadAvatar(user, svg);
    expect(res.status).toBe(400);
    expect((await user.json<UserDetail>('/users/me')).customAvatar).toBe(false);
  });

  it('먼저 올리지 않고 적용하면 거절한다', async () => {
    const user = await loginUser(t);
    expect((await user.fetch('/users/me/avatar', { method: 'PUT' })).status).toBe(400);
  });

  it('프로필 사진 주소가 아닌 경로는 받을 수 없다', async () => {
    const user = await loginUser(t);
    expect((await t.fetch(`/avatars/${user.me.id}/..%2Fsecret`)).status).toBe(404);
    expect((await t.fetch(`/avatars/not-a-uuid/x.webp`)).status).toBe(400);
  });
});
