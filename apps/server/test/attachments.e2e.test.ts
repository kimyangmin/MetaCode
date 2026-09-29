import {
  type AttachmentDto,
  type CommunitySummary,
  type InviteInfo,
  type MessageDto,
  type MessagePage,
  type SocketAck,
  SocketEvent,
  type UploadTicket,
  messagePresentation,
} from '@metacode/shared';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AttachmentsService } from '../src/attachments/attachments.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import { testEnv } from './env.js';
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

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function connect(user: TestUser) {
  const socket = await connectSocket(t, user);
  sockets.push(socket);
  return socket;
}

function send(socket: ClientSocket, channelId: string, content: string, attachmentIds: string[]) {
  return new Promise<SocketAck<MessageDto>>((resolve) =>
    socket.emit(SocketEvent.MessageSend, { channelId, content, attachmentIds }, resolve),
  );
}

/** 올릴 주소 받기 → 저장소에 직접 PUT → 확인 */
async function upload(user: TestUser, channelId: string, fileName: string, body: Uint8Array) {
  const ticket = await user.json<UploadTicket>(
    '/uploads',
    post({ channelId, fileName, size: body.byteLength }),
  );
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body });
  expect(put.status).toBe(200);
  return user.json<AttachmentDto>(`/uploads/${ticket.attachmentId}/complete`, post());
}

/** 로그인한 사용자로 첨부 주소를 열고, 저장소까지 따라간 응답을 돌려준다. */
async function openAttachment(user: TestUser, path: string) {
  const redirect = await user.fetch(path);
  if (redirect.status !== 302) return { status: redirect.status, response: null };
  return { status: 302, response: await fetch(redirect.headers.get('location')!) };
}

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#3366ff' } })
    .png()
    .toBuffer();

let alice: TestUser;
let bob: TestUser;
let community: CommunitySummary;
let channelId: string;

beforeEach(async () => {
  alice = await loginUser(t);
  bob = await loginUser(t);
  community = await alice.json<CommunitySummary>('/communities', post({ name: '첨부' }));
  const invite = await alice.json<InviteInfo>(`/communities/${community.id}/invites`, post());
  await bob.json(`/invites/${invite.code}/accept`, post());
  channelId = community.channels[0]!.id;
});

describe('업로드', () => {
  it('이미지는 실제 형식과 크기를 읽고 썸네일(WebP)을 만든다', async () => {
    const attachment = await upload(alice, channelId, '화면.png', await png(1200, 600));
    expect(attachment).toMatchObject({
      kind: 'image',
      contentType: 'image/png',
      width: 1200,
      height: 600,
      fileName: '화면.png',
    });

    const thumb = await openAttachment(alice, `/attachments/${attachment.id}?variant=thumbnail`);
    expect(thumb.response!.headers.get('content-type')).toBe('image/webp');
    const meta = await sharp(Buffer.from(await thumb.response!.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([480, 240]);

    const original = await openAttachment(alice, `/attachments/${attachment.id}`);
    expect(original.response!.headers.get('content-type')).toBe('image/png');
    expect(original.response!.headers.get('content-disposition')).toMatch(/^inline;/);
  });

  it('이미지가 아닌 파일은 항상 내려받게 하고, 한글 파일 이름을 지킨다', async () => {
    const attachment = await upload(
      alice,
      channelId,
      '회의록 (최종).txt',
      new TextEncoder().encode('내용'),
    );
    expect(attachment).toMatchObject({
      kind: 'file',
      contentType: 'application/octet-stream',
      width: null,
    });

    const opened = await openAttachment(alice, `/attachments/${attachment.id}`);
    expect(opened.response!.headers.get('content-type')).toBe('application/octet-stream');
    const disposition = opened.response!.headers.get('content-disposition')!;
    expect(disposition).toMatch(/^attachment;/);
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent('회의록 ')}%28`);
    expect(await opened.response!.text()).toBe('내용');
  });

  it('확장자가 .png여도 내용이 이미지가 아니면(SVG 등) 일반 파일로 다룬다', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const attachment = await upload(alice, channelId, 'fake.png', new TextEncoder().encode(svg));
    expect(attachment.kind).toBe('file');
    const opened = await openAttachment(alice, `/attachments/${attachment.id}`);
    expect(opened.response!.headers.get('content-disposition')).toMatch(/^attachment;/);
  });

  it('PNG 머리만 있고 깨진 파일도 일반 파일로 다룬다', async () => {
    const broken = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 7),
    ]);
    expect((await upload(alice, channelId, 'broken.png', broken)).kind).toBe('file');
  });

  it('최대 크기를 넘거나 실행 파일이면 올릴 주소를 주지 않는다', async () => {
    const tooBig = await alice.fetch(
      '/uploads',
      post({ channelId, fileName: 'big.bin', size: 1024 * 1024 + 1 }),
    );
    expect(tooBig.status).toBe(413);
    const exe = await alice.fetch('/uploads', post({ channelId, fileName: 'setup.exe', size: 10 }));
    expect(exe.status).toBe(400);
  });

  it('신고한 크기와 다른 파일은 저장소가 거절하고, 확인 단계도 통과하지 못한다', async () => {
    const ticket = await alice.json<UploadTicket>(
      '/uploads',
      post({ channelId, fileName: 'a.bin', size: 5 }),
    );
    const put = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.headers,
      body: new Uint8Array(9),
    });
    expect(put.status).toBe(403);
    expect((await alice.fetch(`/uploads/${ticket.attachmentId}/complete`, post())).status).toBe(
      400,
    );
  });

  it('채널 밖 사람은 그 채널에 올릴 수 없다', async () => {
    const carol = await loginUser(t);
    expect(
      (await carol.fetch('/uploads', post({ channelId, fileName: 'a.txt', size: 1 }))).status,
    ).toBe(404);
  });

  it('보내기 전에 빼면 저장소에서도 지운다', async () => {
    const attachment = await upload(alice, channelId, 'a.txt', new Uint8Array([1, 2, 3]));
    expect((await alice.fetch(`/uploads/${attachment.id}`, { method: 'DELETE' })).status).toBe(204);
    const storage = t.app.get(StorageService);
    expect(await storage.size(`attachments/${channelId}/${attachment.id}`)).toBeNull();
  });
});

describe('메시지에 붙이기', () => {
  it('첨부가 붙은 메시지를 실시간으로 받고, 기록에도 남는다. 첨부만 보내도 된다', async () => {
    const image = await upload(alice, channelId, 'a.png', await png(10, 10));
    const file = await upload(alice, channelId, 'b.txt', new Uint8Array([1]));
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);

    const received = nextEvent(bobSocket, SocketEvent.MessageCreated);
    const ack = await send(aliceSocket, channelId, '', [image.id, file.id]);
    expect(ack.ok).toBe(true);

    const message = await received;
    expect(message.content).toBe('');
    expect(message.attachments.map((a) => [a.fileName, a.kind])).toEqual([
      ['a.png', 'image'],
      ['b.txt', 'file'],
    ]);
    expect(messagePresentation(message)).toBe('attachment-emote');

    const page = await bob.json<MessagePage>(`/channels/${channelId}/messages`);
    expect(page.messages[0]!.attachments.map((a) => a.id)).toEqual([image.id, file.id]);
  });

  it('남의 첨부, 다른 채널의 첨부, 확인 전 첨부, 이미 보낸 첨부는 붙일 수 없고 메시지도 남지 않는다', async () => {
    const aliceSocket = await connect(alice);
    const other = await alice.json<{ id: string }>(
      `/communities/${community.id}/channels`,
      post({ name: '다른' }),
    );

    const bobs = await upload(bob, channelId, 'bob.txt', new Uint8Array([1]));
    const elsewhere = await upload(alice, other.id, 'other.txt', new Uint8Array([1]));
    const pending = await alice.json<UploadTicket>(
      '/uploads',
      post({ channelId, fileName: 'p.txt', size: 1 }),
    );
    const used = await upload(alice, channelId, 'used.txt', new Uint8Array([1]));
    expect((await send(aliceSocket, channelId, '첫 사용', [used.id])).ok).toBe(true);

    for (const id of [bobs.id, elsewhere.id, pending.attachmentId, used.id]) {
      const ack = await send(aliceSocket, channelId, '붙이기 시도', [id]);
      expect(ack.ok).toBe(false);
    }
    const page = await alice.json<MessagePage>(`/channels/${channelId}/messages`);
    expect(page.messages.map((m) => m.content)).toEqual(['첫 사용']);
  });

  it('보내기 전 첨부는 올린 사람만 볼 수 있고, 보낸 뒤에는 채널 사람 모두 볼 수 있다', async () => {
    const attachment = await upload(alice, channelId, 'a.txt', new Uint8Array([1]));
    expect((await bob.fetch(`/attachments/${attachment.id}`)).status).toBe(404);

    const socket = await connect(alice);
    await send(socket, channelId, '', [attachment.id]);
    expect((await openAttachment(bob, `/attachments/${attachment.id}`)).status).toBe(302);

    const carol = await loginUser(t);
    expect((await carol.fetch(`/attachments/${attachment.id}`)).status).toBe(404);
  });

  it('권한 확인 결과(리다이렉트)는 브라우저가 저장하지 않는다 (로그아웃 뒤나 다른 계정에서 재사용 방지)', async () => {
    const attachment = await upload(alice, channelId, 'a.txt', new Uint8Array([1]));
    const redirect = await alice.fetch(`/attachments/${attachment.id}`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('cache-control')).toBe('no-store');
  });

  it('link는 보내지 않고 주소만 준다 (안드로이드 앱의 받기). 권한은 같다', async () => {
    const attachment = await upload(alice, channelId, '받기.txt', new TextEncoder().encode('내용'));
    const res = await alice.fetch(`/attachments/${attachment.id}/link?download=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { url } = (await res.json()) as { url: string };
    // 쿠키 없이 그 주소만으로 받을 수 있다.
    const file = await fetch(url);
    expect(file.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(await file.text()).toBe('내용');

    const carol = await loginUser(t);
    expect((await carol.fetch(`/attachments/${attachment.id}/link`)).status).toBe(404);
  });
});

describe('저장소 정리', () => {
  it('커뮤니티를 지우면 그 안의 첨부 파일(썸네일 포함)도 저장소에서 지운다', async () => {
    const image = await upload(alice, channelId, 'a.png', await png(10, 10));
    const socket = await connect(alice);
    await send(socket, channelId, '', [image.id]);

    expect((await alice.fetch(`/communities/${community.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    const storage = t.app.get(StorageService);
    await expect
      .poll(() => storage.size(`attachments/${channelId}/${image.id}`), { timeout: 3000 })
      .toBeNull();
    expect(await storage.size(`thumbnails/${channelId}/${image.id}.webp`)).toBeNull();
  });

  it('보내지 않은 채 하루가 지난 첨부는 정리 작업이 지운다 (보낸 첨부는 남긴다)', async () => {
    const orphan = await upload(alice, channelId, 'orphan.txt', new Uint8Array([1]));
    const sent = await upload(alice, channelId, 'sent.txt', new Uint8Array([1]));
    const socket = await connect(alice);
    await send(socket, channelId, '', [sent.id]);

    const db = new pg.Client({ connectionString: testEnv.DATABASE_URL });
    await db.connect();
    await db.query(
      `UPDATE attachments SET created_at = now() - interval '25 hours' WHERE id = ANY($1)`,
      [[orphan.id, sent.id]],
    );
    await db.end();

    await t.app.get(AttachmentsService).cleanupOrphans();
    const storage = t.app.get(StorageService);
    expect(await storage.size(`attachments/${channelId}/${orphan.id}`)).toBeNull();
    expect(await storage.size(`attachments/${channelId}/${sent.id}`)).toBe(1);
  });
});
