import {
  type AttachmentDto,
  type CommunitySummary,
  type DmSummary,
  type InviteInfo,
  type MessageDto,
  type MessagePage,
  type SocketAck,
  SocketEvent,
  type UploadTicket,
} from '@metacode/shared';
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

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function connect(user: TestUser) {
  const socket = await connectSocket(t, user);
  sockets.push(socket);
  return socket;
}

function send(
  socket: ClientSocket,
  payload: { channelId: string; content?: string; attachmentIds?: string[]; replyToId?: string },
) {
  return new Promise<SocketAck<MessageDto>>((resolve) =>
    socket.emit(SocketEvent.MessageSend, payload, resolve),
  );
}

async function sendOk(socket: ClientSocket, payload: Parameters<typeof send>[1]) {
  const ack = await send(socket, payload);
  if (!ack.ok) throw new Error(ack.error);
  return ack.data;
}

function forward(socket: ClientSocket, messageId: string, channelId: string) {
  return new Promise<SocketAck<MessageDto>>((resolve) =>
    socket.emit(SocketEvent.MessageForward, { messageId, channelId }, resolve),
  );
}

async function upload(user: TestUser, channelId: string, fileName: string, body: Uint8Array) {
  const ticket = await user.json<UploadTicket>(
    '/uploads',
    post({ channelId, fileName, size: body.byteLength }),
  );
  await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body });
  return user.json<AttachmentDto>(`/uploads/${ticket.attachmentId}/complete`, post());
}

/** alice가 만든 커뮤니티(채널 둘)에 bob이 들어온 상태 */
async function setup() {
  const alice = await loginUser(t);
  const bob = await loginUser(t);
  const community = await alice.json<CommunitySummary>('/communities', post({ name: '메시지' }));
  const other = await alice.json<{ id: string }>(
    `/communities/${community.id}/channels`,
    post({ name: '잡담' }),
  );
  const invite = await alice.json<InviteInfo>(`/communities/${community.id}/invites`, post());
  await bob.json(`/invites/${invite.code}/accept`, post());
  return { alice, bob, community, general: community.channels[0]!.id, other: other.id };
}

describe('읽음 위치', () => {
  it('내가 보낸(전달한) 메시지는 읽은 것으로 남고, 다른 사람에게는 안 읽음이다', async () => {
    const { alice, bob, community, general, other } = await setup();
    const aliceSocket = await connect(alice);
    const sent = await sendOk(aliceSocket, { channelId: general, content: '보냄' });
    const forwarded = await forward(aliceSocket, sent.id, other);
    if (!forwarded.ok) throw new Error(forwarded.error);

    const channels = async (user: TestUser) =>
      (await user.json<CommunitySummary[]>('/communities')).find((c) => c.id === community.id)!
        .channels;
    const mine = await channels(alice);
    expect(mine.find((c) => c.id === general)).toMatchObject({
      lastMessageId: sent.id,
      lastReadMessageId: sent.id,
    });
    expect(mine.find((c) => c.id === other)).toMatchObject({
      lastMessageId: forwarded.data.id,
      lastReadMessageId: forwarded.data.id,
    });
    const bobs = await channels(bob);
    expect(bobs.find((c) => c.id === general)?.lastReadMessageId).not.toBe(sent.id);
  });
});

describe('답장', () => {
  it('같은 채널의 메시지에 답장하면 원래 메시지를 짧게 붙여 보낸다', async () => {
    const { alice, bob, general } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const original = await sendOk(aliceSocket, {
      channelId: general,
      content: '가'.repeat(300),
    });

    const received = nextEvent(aliceSocket, SocketEvent.MessageCreated, (m) => m.replyTo !== null);
    await sendOk(bobSocket, { channelId: general, content: '답장', replyToId: original.id });
    const reply = await received;
    expect(reply.replyTo).toMatchObject({
      id: original.id,
      author: { id: alice.me.id },
      attachmentCount: 0,
    });
    expect(reply.replyTo!.content).toHaveLength(120);

    // 기록을 다시 불러와도 붙어 있다.
    const page = await bob.json<MessagePage>(`/channels/${general}/messages`);
    expect(page.messages[0]!.replyTo?.id).toBe(original.id);
  });

  it('다른 채널의 메시지에는 답장할 수 없다', async () => {
    const { alice, general, other } = await setup();
    const socket = await connect(alice);
    const elsewhere = await sendOk(socket, { channelId: other, content: '다른 채널' });
    const ack = await send(socket, { channelId: general, content: 'x', replyToId: elsewhere.id });
    expect(ack.ok).toBe(false);
  });
});

describe('전달', () => {
  it('다른 채널이나 DM으로 전달하면 전달한 사람이 보낸 새 메시지가 되고, 첨부도 복사된다', async () => {
    const { alice, bob, general } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const file = await upload(alice, general, 'memo.txt', new TextEncoder().encode('hello'));
    const original = await sendOk(aliceSocket, {
      channelId: general,
      content: '전달할 글',
      attachmentIds: [file.id],
    });

    const dm = await bob.json<DmSummary>('/dms', post({ userIds: [alice.me.id] }));
    const received = nextEvent(
      aliceSocket,
      SocketEvent.MessageCreated,
      (m) => m.channelId === dm.id,
    );
    const ack = await forward(bobSocket, original.id, dm.id);
    if (!ack.ok) throw new Error(ack.error);
    const forwarded = await received;
    expect(forwarded).toMatchObject({
      channelId: dm.id,
      author: { id: bob.me.id },
      content: '전달할 글',
      forwarded: true,
    });
    expect(forwarded.attachments).toHaveLength(1);
    expect(forwarded.attachments[0]).toMatchObject({ fileName: 'memo.txt', size: 5 });
    expect(forwarded.attachments[0]!.id).not.toBe(file.id);

    // 복사한 파일을 DM 참여자가 받을 수 있다.
    const redirect = await alice.fetch(`/attachments/${forwarded.attachments[0]!.id}`);
    expect(redirect.status).toBe(302);
    const body = await (await fetch(redirect.headers.get('location')!)).text();
    expect(body).toBe('hello');
  });

  it('볼 수 없는 메시지나 쓸 수 없는 곳으로는 전달할 수 없다', async () => {
    const { alice, general } = await setup();
    const carol = await loginUser(t);
    const aliceSocket = await connect(alice);
    const carolSocket = await connect(carol);
    const secret = await sendOk(aliceSocket, { channelId: general, content: '비밀' });
    const carolDm = await carol.json<DmSummary>('/dms', post({ userIds: [alice.me.id] }));

    // carol은 이 커뮤니티 멤버가 아니다.
    expect((await forward(carolSocket, secret.id, carolDm.id)).ok).toBe(false);

    // 음성 채널로는 전달하지 않는다.
    const community = (await alice.json<CommunitySummary[]>('/communities')).find((c) =>
      c.channels.some((ch) => ch.id === general),
    )!;
    const voice = await alice.json<{ id: string }>(
      `/communities/${community.id}/channels`,
      post({ name: '통화', type: 'VOICE' }),
    );
    expect((await forward(aliceSocket, secret.id, voice.id)).ok).toBe(false);
  });
});

function edit(socket: ClientSocket, messageId: string, content: string) {
  return new Promise<SocketAck<MessageDto>>((resolve) =>
    socket.emit(SocketEvent.MessageEdit, { messageId, content }, resolve),
  );
}

function remove(socket: ClientSocket, messageId: string) {
  return new Promise<SocketAck<null>>((resolve) =>
    socket.emit(SocketEvent.MessageDelete, { messageId }, resolve),
  );
}

describe('수정과 삭제', () => {
  it('내가 보낸 메시지를 고치면 채널에 알리고, 기록에도 고친 시각과 함께 남는다', async () => {
    const { alice, bob, general } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const message = await sendOk(aliceSocket, { channelId: general, content: '처음' });
    expect(message.editedAt).toBeNull();

    const updated = nextEvent(bobSocket, SocketEvent.MessageUpdated);
    const ack = await edit(aliceSocket, message.id, '  고친 글  ');
    expect(ack.ok && ack.data).toMatchObject({ id: message.id, content: '고친 글' });
    const received = await updated;
    expect(received.content).toBe('고친 글');
    expect(received.editedAt).not.toBeNull();

    const page = await bob.json<MessagePage>(`/channels/${general}/messages`);
    expect(page.messages[0]).toMatchObject({ id: message.id, content: '고친 글' });
  });

  it('남의 메시지는 고치거나 지울 수 없고, 첨부 없는 글은 비울 수 없다', async () => {
    const { alice, bob, general } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const message = await sendOk(aliceSocket, { channelId: general, content: '앨리스 글' });

    const byBob = await edit(bobSocket, message.id, '가로채기');
    expect(byBob).toMatchObject({ ok: false, error: '내가 보낸 메시지만 고칠 수 있습니다.' });
    expect(await remove(bobSocket, message.id)).toMatchObject({ ok: false });
    expect(await edit(aliceSocket, message.id, '   ')).toMatchObject({ ok: false });

    // 멤버가 아니면 있는지도 모른다.
    const carol = await loginUser(t);
    const carolSocket = await connect(carol);
    expect(await remove(carolSocket, message.id)).toMatchObject({
      ok: false,
      error: '채널을 찾을 수 없습니다.',
    });
  });

  it('커뮤니티 소유자·관리자는 남의 메시지도 지울 수 있다', async () => {
    const { alice, bob, community, general } = await setup();
    const carol = await loginUser(t);
    const invite = await alice.json<InviteInfo>(`/communities/${community.id}/invites`, post());
    await carol.json(`/invites/${invite.code}/accept`, post());
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const carolSocket = await connect(carol);

    // 소유자(alice)가 bob의 메시지를 지운다.
    const byBob = await sendOk(bobSocket, { channelId: general, content: '밥 글' });
    const deleted = nextEvent(bobSocket, SocketEvent.MessageDeleted);
    expect(await remove(aliceSocket, byBob.id)).toEqual({ ok: true, data: null });
    expect(await deleted).toMatchObject({ messageId: byBob.id });

    // 일반 멤버(carol)는 못 지우다가, 관리자가 되면 지울 수 있다. 남의 글을 고치지는 못한다.
    const byAlice = await sendOk(aliceSocket, { channelId: general, content: '앨리스 글' });
    expect(await remove(carolSocket, byAlice.id)).toMatchObject({
      ok: false,
      error: '내가 보낸 메시지만 지울 수 있습니다.',
    });
    await alice.fetch(`/communities/${community.id}/members/${carol.me.id}/admin`, {
      method: 'PUT',
      body: JSON.stringify({ admin: true }),
    });
    expect(await edit(carolSocket, byAlice.id, '가로채기')).toMatchObject({ ok: false });
    expect(await remove(carolSocket, byAlice.id)).toEqual({ ok: true, data: null });
  });

  it('DM에서는 남의 메시지를 지울 수 없다', async () => {
    const { alice, bob } = await setup();
    const dm = await bob.json<DmSummary>('/dms', post({ userIds: [alice.me.id] }));
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const message = await sendOk(bobSocket, { channelId: dm.id, content: 'DM 글' });
    expect(await remove(aliceSocket, message.id)).toMatchObject({ ok: false });
  });

  it('지우면 채널에 알리고(남은 최신 메시지와 함께), 첨부와 답장의 원래 메시지 표시도 사라진다', async () => {
    const { alice, bob, general } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const first = await sendOk(aliceSocket, { channelId: general, content: '먼저' });
    const png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    const attachment = await upload(alice, general, 'dot.png', png);
    const target = await sendOk(aliceSocket, {
      channelId: general,
      content: '지울 글',
      attachmentIds: [attachment.id],
    });
    const reply = await sendOk(bobSocket, {
      channelId: general,
      content: '답장',
      replyToId: target.id,
    });

    const deleted = nextEvent(bobSocket, SocketEvent.MessageDeleted);
    expect(await remove(aliceSocket, target.id)).toEqual({ ok: true, data: null });
    expect(await deleted).toEqual({
      channelId: general,
      messageId: target.id,
      lastMessageId: reply.id,
    });

    const page = await bob.json<MessagePage>(`/channels/${general}/messages`);
    expect(page.messages.map((m) => m.id)).toEqual([reply.id, first.id]);
    expect(page.messages[0]!.replyTo).toBeNull();
    expect((await alice.fetch(`/attachments/${attachment.id}`)).status).toBe(404);
  });
});
