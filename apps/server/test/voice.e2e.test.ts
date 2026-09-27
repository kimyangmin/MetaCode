import {
  type ChannelSummary,
  type CommunitySummary,
  type DmSummary,
  type InviteInfo,
  type PlazaId,
  type PlazaSnapshot,
  type SocketAck,
  SocketEvent,
  type VoiceCall,
  type VoiceJoinResult,
} from '@metacode/shared';
import { Redis } from 'ioredis';
import { TokenVerifier } from 'livekit-server-sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from './env.js';
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
let redis: Redis;
let sockets: ClientSocket[] = [];

beforeAll(async () => {
  t = await startTestApp();
  redis = new Redis(testEnv.REDIS_URL);
});

afterEach(() => {
  for (const s of sockets) s.disconnect();
  sockets = [];
});

afterAll(async () => {
  await redis.quit();
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

function join(socket: ClientSocket, channelId: string) {
  return new Promise<SocketAck<VoiceJoinResult>>((resolve) =>
    socket.emit(SocketEvent.VoiceJoin, { channelId }, resolve),
  );
}

async function joinOk(socket: ClientSocket, channelId: string) {
  const ack = await join(socket, channelId);
  if (!ack.ok) throw new Error(ack.error);
  return ack.data;
}

function sync(socket: ClientSocket) {
  return new Promise<VoiceCall[]>((resolve) =>
    socket.emit(SocketEvent.VoiceSync, {}, (ack) => resolve(ack.ok ? ack.data : [])),
  );
}

function setProximity(socket: ClientSocket, channelId: string, enabled: boolean) {
  return new Promise<SocketAck<null>>((resolve) =>
    socket.emit(SocketEvent.VoiceSetProximity, { channelId, enabled }, resolve),
  );
}

/** alice가 만든 커뮤니티(음성 채널 두 개)에 bob이 들어온 상태 */
async function setup() {
  const alice = await loginUser(t);
  const bob = await loginUser(t);
  const community = await alice.json<CommunitySummary>('/communities', post({ name: '통화' }));
  const lounge = await alice.json<ChannelSummary>(
    `/communities/${community.id}/channels`,
    post({ name: 'lounge', type: 'VOICE' }),
  );
  const meeting = await alice.json<ChannelSummary>(
    `/communities/${community.id}/channels`,
    post({ name: 'meeting', type: 'VOICE' }),
  );
  const invite = await alice.json<InviteInfo>(`/communities/${community.id}/invites`, post());
  await bob.json(`/invites/${invite.code}/accept`, post());
  const text = community.channels[0]!;
  return { alice, bob, community, lounge, meeting, text };
}

describe('음성 채널', () => {
  it('관리자는 음성 채널을 만들 수 있고, 음성 채널에는 메시지를 보낼 수 없다', async () => {
    const { alice, lounge } = await setup();
    expect(lounge).toMatchObject({ type: 'VOICE', name: 'lounge' });

    const socket = await connect(alice);
    const ack = await new Promise<SocketAck<unknown>>((resolve) =>
      socket.emit(SocketEvent.MessageSend, { channelId: lounge.id, content: '안녕' }, resolve),
    );
    expect(ack.ok).toBe(false);
  });
});

describe('통화 참여', () => {
  it('들어가면 음성 서버 입장권을 받고, 채널을 볼 수 있는 사람에게 알린다', async () => {
    const { alice, bob, lounge } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);

    const joined = nextEvent(bobSocket, SocketEvent.VoiceJoined);
    const result = await joinOk(aliceSocket, lounge.id);
    expect(result.url).toBe(testEnv.LIVEKIT_PUBLIC_URL);
    expect(result.call).toMatchObject({ channelId: lounge.id, proximity: false });
    expect(result.call.members.map((m) => m.user.id)).toEqual([alice.me.id]);
    expect(await joined).toMatchObject({
      channelId: lounge.id,
      member: {
        user: { id: alice.me.id },
        muted: false,
        deafened: false,
        speaking: false,
        sharing: false,
      },
    });

    // 입장권: 신원은 사용자 ID, 이 채널의 방에만, 마이크만 올릴 수 있다.
    const claims = await new TokenVerifier(
      testEnv.LIVEKIT_API_KEY,
      testEnv.LIVEKIT_API_SECRET,
    ).verify(result.token);
    expect(claims.sub).toBe(alice.me.id);
    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: `channel-${lounge.id}`,
      canPublishSources: ['microphone', 'screen_share', 'screen_share_audio'],
    });
  });

  it('멤버가 아니거나 텍스트 채널이면 들어갈 수 없다', async () => {
    const { lounge, text } = await setup();
    const carol = await loginUser(t);
    expect((await join(await connect(carol), lounge.id)).ok).toBe(false);

    const { alice } = await setup();
    expect((await join(await connect(alice), text.id)).ok).toBe(false);
  });

  it('진행 중인 통화 목록은 볼 수 있는 사람에게만 준다', async () => {
    const { alice, bob, lounge } = await setup();
    await joinOk(await connect(alice), lounge.id);

    const calls = await sync(await connect(bob));
    expect(calls.find((c) => c.channelId === lounge.id)?.members[0]?.user.id).toBe(alice.me.id);

    const carol = await loginUser(t);
    expect((await sync(await connect(carol))).map((c) => c.channelId)).not.toContain(lounge.id);
  });

  it('한 사람은 통화 하나에만: 다른 채널에 들어가면 앞의 채널에서 나온다', async () => {
    const { alice, bob, lounge, meeting } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    await joinOk(aliceSocket, lounge.id);

    const left = nextEvent(bobSocket, SocketEvent.VoiceLeft, (p) => p.channelId === lounge.id);
    await joinOk(aliceSocket, meeting.id);
    expect(await left).toEqual({ channelId: lounge.id, userId: alice.me.id });

    const calls = await sync(bobSocket);
    expect(calls.map((c) => c.channelId)).toContain(meeting.id);
    expect(calls.map((c) => c.channelId)).not.toContain(lounge.id);
  });

  it('음소거, 헤드셋, 말하는 중 상태를 알린다. 통화를 가진 연결이 아니면 무시한다', async () => {
    const { alice, bob, lounge } = await setup();
    const aliceSocket = await connect(alice);
    const aliceOtherTab = await connect(alice);
    const bobSocket = await connect(bob);
    await joinOk(aliceSocket, lounge.id);

    const updated = nextEvent(bobSocket, SocketEvent.VoiceUpdated);
    aliceSocket.emit(SocketEvent.VoiceUpdate, { muted: true, deafened: false, speaking: false });
    expect((await updated).member).toMatchObject({ user: { id: alice.me.id }, muted: true });

    // 화면 공유를 시작하면 볼 수 있게 알린다.
    const sharing = nextEvent(bobSocket, SocketEvent.VoiceUpdated, (p) => p.member.sharing);
    aliceSocket.emit(SocketEvent.VoiceUpdate, {
      muted: true,
      deafened: false,
      speaking: false,
      sharing: true,
    });
    expect((await sharing).member).toMatchObject({ user: { id: alice.me.id }, sharing: true });

    aliceOtherTab.emit(SocketEvent.VoiceUpdate, { muted: false, deafened: true, speaking: true });
    await expectNoEvent(bobSocket, SocketEvent.VoiceUpdated);
  });

  it('나가면 알리고, 아무도 없으면 통화가 끝난다', async () => {
    const { alice, bob, lounge } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    await joinOk(aliceSocket, lounge.id);

    const left = nextEvent(bobSocket, SocketEvent.VoiceLeft);
    aliceSocket.emit(SocketEvent.VoiceLeave, {});
    expect(await left).toEqual({ channelId: lounge.id, userId: alice.me.id });
    expect((await sync(bobSocket)).map((c) => c.channelId)).not.toContain(lounge.id);
  });

  it('연결이 끊기면 잠시 뒤 통화에서 빠지고, 그 전에 다시 들어오면 그대로 남는다', async () => {
    const { alice, bob, lounge } = await setup();
    const bobSocket = await connect(bob);

    // 끊겼다가 바로 다시 들어온다: 나간 것으로 알리지 않는다.
    const first = await connect(alice);
    await joinOk(first, lounge.id);
    first.disconnect();
    await joinOk(await connect(alice), lounge.id);
    await expectNoEvent(bobSocket, SocketEvent.VoiceLeft, () => true, 600);

    // 끊기고 돌아오지 않는다: 유예 시간(테스트 300ms) 뒤에 뺀다.
    const left = nextEvent(bobSocket, SocketEvent.VoiceLeft);
    sockets.at(-1)!.disconnect();
    expect(await left).toEqual({ channelId: lounge.id, userId: alice.me.id });
  });

  it('DM에서도 통화할 수 있고, 참여자에게만 알린다', async () => {
    const { alice, bob } = await setup();
    const carol = await loginUser(t);
    const dm = await alice.json<DmSummary>('/dms', post({ userIds: [bob.me.id] }));
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const carolSocket = await connect(carol);

    const joined = nextEvent(bobSocket, SocketEvent.VoiceJoined);
    const notJoined = expectNoEvent(carolSocket, SocketEvent.VoiceJoined);
    await joinOk(aliceSocket, dm.id);
    expect((await joined).channelId).toBe(dm.id);
    await notJoined;
    expect((await join(carolSocket, dm.id)).ok).toBe(false);
  });

  it('커뮤니티를 나가면 그 커뮤니티의 통화에서 빠진다', async () => {
    const { alice, bob, community, lounge } = await setup();
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    await joinOk(bobSocket, lounge.id);

    const left = nextEvent(aliceSocket, SocketEvent.VoiceLeft);
    await bob.fetch(`/communities/${community.id}/leave`, post());
    expect(await left).toEqual({ channelId: lounge.id, userId: bob.me.id });
  });
});

describe('근접 음성', () => {
  /** alice와 bob이 같은 음성 채널에 들어가 광장을 연 상태 */
  async function inCall() {
    const ctx = await setup();
    const aliceSocket = await connect(ctx.alice);
    const bobSocket = await connect(ctx.bob);
    const plazaId: PlazaId = `community:${ctx.community.id}`;
    for (const socket of [aliceSocket, bobSocket]) {
      await new Promise<SocketAck<PlazaSnapshot>>((resolve) =>
        socket.emit(SocketEvent.PlazaWatch, { plazaId }, resolve),
      );
      await joinOk(socket, ctx.lounge.id);
    }
    return { ...ctx, aliceSocket, bobSocket, plazaId };
  }

  /** 위치를 직접 옮겨 두고(테스트용), 그 자리에서 조금 움직여 서버가 다시 계산하게 한다 */
  async function teleportAndStep(
    socket: ClientSocket,
    plazaId: PlazaId,
    userId: string,
    x: number,
  ) {
    const y = 20 * 16 + 15;
    await redis.hset(
      `plaza:pos:${plazaId}`,
      userId,
      JSON.stringify({ x, y, dir: 'down', moving: false, t: Date.now() - 200 }),
    );
    socket.emit(SocketEvent.PlazaMove, { plazaId, x: x + 4, y, dir: 'right', moving: true });
  }

  it('참여자만 켜고 끌 수 있고, 모두에게 알리며, 다음 통화에도 유지된다', async () => {
    const { lounge, aliceSocket, bobSocket } = await inCall();
    const carol = await loginUser(t);
    expect((await setProximity(await connect(carol), lounge.id, true)).ok).toBe(false);

    const changed = nextEvent(aliceSocket, SocketEvent.VoiceProximityChanged);
    expect((await setProximity(bobSocket, lounge.id, true)).ok).toBe(true);
    expect(await changed).toEqual({ channelId: lounge.id, enabled: true });

    // 모두 나갔다가 다시 들어와도 켜져 있다.
    aliceSocket.emit(SocketEvent.VoiceLeave, {});
    bobSocket.emit(SocketEvent.VoiceLeave, {});
    await new Promise((r) => setTimeout(r, 200));
    const rejoined = await joinOk(aliceSocket, lounge.id);
    expect(rejoined.call.proximity).toBe(true);
  });

  it('켜면 광장 거리로 음량을 계산해서, 멀어지면 0(들리지 않음)을 보낸다', async () => {
    const { alice, bob, lounge, aliceSocket, bobSocket, plazaId } = await inCall();

    // 가까이 둔 뒤 켠다.
    await teleportAndStep(aliceSocket, plazaId, alice.me.id, 10 * 16 + 8);
    await teleportAndStep(bobSocket, plazaId, bob.me.id, 11 * 16 + 8);
    await new Promise((r) => setTimeout(r, 200));
    const near = nextEvent(bobSocket, SocketEvent.VoiceGains);
    await setProximity(aliceSocket, lounge.id, true);
    expect(await near).toEqual({ channelId: lounge.id, gains: { [alice.me.id]: 1 } });

    // alice가 멀리 가면 bob에게 alice는 0이 된다.
    const far = nextEvent(bobSocket, SocketEvent.VoiceGains, (p) => p.gains[alice.me.id] === 0);
    await teleportAndStep(aliceSocket, plazaId, alice.me.id, 40 * 16 + 8);
    expect(await far).toEqual({ channelId: lounge.id, gains: { [alice.me.id]: 0 } });
  });

  it('꺼져 있으면 음량을 보내지 않는다', async () => {
    const { alice, aliceSocket, bobSocket, plazaId } = await inCall();
    await teleportAndStep(aliceSocket, plazaId, alice.me.id, 40 * 16 + 8);
    await expectNoEvent(bobSocket, SocketEvent.VoiceGains);
  });
});
