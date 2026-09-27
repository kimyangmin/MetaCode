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
