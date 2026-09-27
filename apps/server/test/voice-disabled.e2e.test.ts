import {
  type ChannelSummary,
  type CommunitySummary,
  type SocketAck,
  SocketEvent,
  type VoiceJoinResult,
} from '@metacode/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type TestApp, connectSocket, loginUser, startTestApp } from './harness.js';

let t: TestApp;

beforeAll(async () => {
  // 음성 서버 설정이 없는 운영 환경 (LiveKit을 아직 띄우지 않은 서버)
  process.env.LIVEKIT_URL = '';
  t = await startTestApp();
});

afterAll(async () => {
  await t.close();
});

it('음성 서버가 설정되지 않았으면 서버는 뜨고, 통화에 들어가려 하면 이유를 알려 준다', async () => {
  const alice = await loginUser(t);
  const community = await alice.json<CommunitySummary>('/communities', {
    method: 'POST',
    body: JSON.stringify({ name: '음성 없음' }),
  });
  const voice = await alice.json<ChannelSummary>(`/communities/${community.id}/channels`, {
    method: 'POST',
    body: JSON.stringify({ name: 'lounge', type: 'VOICE' }),
  });

  const socket = await connectSocket(t, alice);
  const ack = await new Promise<SocketAck<VoiceJoinResult>>((resolve) =>
    socket.emit(SocketEvent.VoiceJoin, { channelId: voice.id }, resolve),
  );
  socket.disconnect();
  expect(ack).toEqual({ ok: false, error: '음성 서버가 설정되지 않아 통화할 수 없습니다.' });
});
