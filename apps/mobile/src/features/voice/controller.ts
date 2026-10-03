import { trackVolume } from '@metacode/client';
import {
  SocketEvent,
  type VoiceCall,
  type VoiceGains,
  type VoiceJoinResult,
  type VoiceJoined,
  type VoiceLeft,
  type VoiceMember,
  type VoiceProximityChanged,
} from '@metacode/shared';
import { PermissionsAndroid, Platform } from 'react-native';
import { startCallService, stopCallService } from '../../../modules/call-service';
import type { AppSocket } from '../../realtime/RealtimeProvider';
import type { VoiceConnection } from './connection';
import { useVoiceStore } from './store';

const REQUEST_TIMEOUT_MS = 10_000;

const store = useVoiceStore.getState;

/** 마이크 권한 (처음이면 묻는다). 거절하면 듣기만 한다 */
async function micPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(permission)) return true;
  const result = await PermissionsAndroid.request(permission, {
    title: '마이크 권한',
    message: '음성 통화에서 말하려면 마이크가 필요합니다.',
    buttonPositive: '허용',
    buttonNegative: '거절',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * 음성 통화 제어 (웹 features/voice/controller.ts의 휴대폰판): 진행 중인 통화 목록을 서버 이벤트로 유지하고,
 * 내 통화의 LiveKit 연결을 관리한다. 상태는 useVoiceStore에 두고 화면은 그것을 읽는다.
 */
export class VoiceController {
  private socket: AppSocket | null = null;
  private connection: VoiceConnection | null = null;
  /** 내가 말하는 중 (이 기기의 연결이 알려 준 값) */
  private speaking = false;
  /** 화면 보기 요청 번호 (watch) */
  private watchRequest = 0;
  /** 이번 통화에서 마이크 권한을 받았다 (join이 들어가기 전에 묻는다) */
  private micAllowed = true;

  constructor(private readonly meId: string) {}

  /** 실시간 연결에 붙는다. 떼어 낼 함수를 돌려준다 */
  attach(socket: AppSocket): () => void {
    this.socket = socket;
    const resync = () => void this.resync();
    const onMember = ({ channelId, member }: VoiceJoined) =>
      store().upsertMember(channelId, this.withLocalSpeaking(channelId, member));
    const onLeft = ({ channelId, userId }: VoiceLeft) => {
      store().removeMember(channelId, userId);
      // 내가 들어가 있던 통화에서 빠졌다: 다른 기기가 통화를 가져갔거나, 커뮤니티를 나갔거나, 오래 끊겼다.
      if (userId === this.meId && store().session?.channelId === channelId) {
        void this.dropConnection();
        store().setSession(null);
        store().patch({ gains: {} });
      }
    };
    const onProximity = ({ channelId, enabled }: VoiceProximityChanged) => {
      store().setProximity(channelId, enabled);
      if (store().session?.channelId === channelId) {
        store().patch({ gains: {} });
        this.applyVolumes();
      }
    };
    const onGains = ({ channelId, gains }: VoiceGains) => {
      if (store().session?.channelId !== channelId) return;
      store().patch({ gains });
      this.applyVolumes();
    };

    socket.on('connect', resync);
    socket.on(SocketEvent.VoiceJoined, onMember);
    socket.on(SocketEvent.VoiceUpdated, onMember);
    socket.on(SocketEvent.VoiceLeft, onLeft);
    socket.on(SocketEvent.VoiceProximityChanged, onProximity);
    socket.on(SocketEvent.VoiceGains, onGains);
    if (socket.connected) resync();
    return () => {
      socket.off('connect', resync);
      socket.off(SocketEvent.VoiceJoined, onMember);
      socket.off(SocketEvent.VoiceUpdated, onMember);
      socket.off(SocketEvent.VoiceLeft, onLeft);
      socket.off(SocketEvent.VoiceProximityChanged, onProximity);
      socket.off(SocketEvent.VoiceGains, onGains);
      if (this.socket === socket) this.socket = null;
    };
  }

  /** 로그아웃 등으로 내려갈 때 */
  dispose(): void {
    void this.dropConnection();
    useVoiceStore.setState({ session: null, calls: {}, gains: {}, error: null, watching: null });
  }

  /**
   * 통화 목록을 새로 받는다 (접속, 재접속). 통화 중이면 서버에 이 연결로 다시 묶는다
   * (서버는 통화를 실시간 연결에 묶어 둔다).
   */
  async resync(): Promise<void> {
    const socket = this.socket;
    if (!socket?.connected) return;
    const calls = await socket
      .timeout(REQUEST_TIMEOUT_MS)
      .emitWithAck(SocketEvent.VoiceSync, {})
      .catch(() => null);
    if (calls?.ok) store().setCalls(calls.data);
    const { session } = store();
    if (session && session.status !== 'connecting' && this.connection) {
      try {
        this.putCall((await this.requestJoin(session.channelId)).call);
        this.sendState();
      } catch {
        this.leave();
      }
    }
  }

  /** keepWatch: 화면을 보려고 들어가는 중이라 보기 창을 닫지 않는다 (watch) */
  async join(channelId: string, keepWatch = false): Promise<void> {
    if (store().session?.channelId === channelId) return;
    await this.dropConnection(keepWatch);
    store().setSession({ channelId, status: 'connecting', listenOnly: false });
    store().patch({ error: null, gains: {} });
    try {
      // 마이크 권한은 서버에 들어가기 전에 묻는다. 권한 창에 머무는 동안은 통화 유지 서비스가 아직 없어서, 화면이
      // 꺼지면 앱이 멈추고 실시간 연결이 끊겨 서버가 통화에서 뺐다 (들어간 채로 멈춘 상태가 되었음).
      const { muted, deafened } = store();
      this.micAllowed = muted || deafened ? true : await micPermission();
      if (store().session?.channelId !== channelId) return;
      const result = await this.requestJoin(channelId);
      // 기다리는 사이 다른 통화를 눌렀거나 나갔다.
      if (store().session?.channelId !== channelId) return;
      this.putCall(result.call);
      await this.connect(channelId, result);
    } catch (error) {
      if (store().session?.channelId !== channelId) return;
      store().setSession(null);
      store().patch({
        error: error instanceof Error ? error.message : '통화에 들어가지 못했습니다.',
      });
    }
  }

  leave(): void {
    if (!store().session) return;
    void this.dropConnection();
    this.socket?.emit(SocketEvent.VoiceLeave, {});
    store().setSession(null);
    store().patch({ gains: {}, error: null });
  }

  async toggleMute(): Promise<void> {
    const { muted, deafened, session } = store();
    // 듣기만 하던 중이면 마이크를 다시 켜 본다 (권한을 다시 묻는다).
    const next = session?.listenOnly ? false : !muted;
    // 헤드셋이 꺼진 채로 마이크를 켜면 헤드셋도 켠다 (말하는데 못 듣는 상태를 막는다).
    store().patch({ muted: next, deafened: next ? deafened : false });
    if (this.connection && session) {
      let ok = true;
      if (next) await this.connection.setMicEnabled(false);
      else ok = (await micPermission()) && (await this.connection.setMicEnabled(true));
      store().setSession({ ...session, listenOnly: !ok });
      this.applyVolumes();
    }
    this.sendState();
  }

  async toggleDeafen(): Promise<void> {
    const { muted, deafened, session } = store();
    const next = !deafened;
    store().patch({ deafened: next });
    // 헤드셋을 끄면 마이크도 끈다 (Discord와 같이). 다시 켜면 원래 음소거 상태로 돌아간다.
    await this.connection?.setMicEnabled(!next && !muted && !session?.listenOnly);
    this.applyVolumes();
    this.sendState();
  }

  async setProximity(enabled: boolean): Promise<void> {
    const { session } = store();
    if (!session || !this.socket) return;
    const ack = await this.socket
      .timeout(REQUEST_TIMEOUT_MS)
      .emitWithAck(SocketEvent.VoiceSetProximity, { channelId: session.channelId, enabled })
      .catch(() => ({ ok: false as const, error: '근접 음성을 바꾸지 못했습니다.' }));
    if (!ack.ok) store().patch({ error: ack.error });
  }

  /**
   * 누군가의 화면 공유 보기. 그 통화에 없으면 마이크를 끈 채로 먼저 들어간다 (Discord처럼 통화 참여자만 볼 수
   * 있다). null이면 보기를 닫는다 (영상 구독도 끊는다).
   */
  async watch(channelId: string | null, userId: string | null): Promise<void> {
    const request = ++this.watchRequest;
    if (!channelId || !userId) {
      store().patch({ watching: null });
      this.applyVolumes();
      return;
    }
    const joining = store().session?.channelId !== channelId;
    store().patch({
      watching: {
        channelId,
        userId,
        streamUrl: joining ? null : (this.connection?.screenOf(userId) ?? null),
        joining,
        error: null,
        mutedOnJoin: false,
      },
    });
    if (joining) {
      const wasMuted = store().muted;
      store().patch({ muted: true });
      await this.join(channelId, true);
      if (request !== this.watchRequest) return;
      if (store().session?.channelId !== channelId) {
        store().patch({
          muted: wasMuted,
          watching: {
            channelId,
            userId,
            streamUrl: null,
            joining: false,
            error: store().error ?? '통화에 들어가지 못했습니다.',
            mutedOnJoin: false,
          },
        });
        return;
      }
      store().patch({
        watching: {
          channelId,
          userId,
          streamUrl: this.connection?.screenOf(userId) ?? null,
          joining: false,
          error: null,
          mutedOnJoin: !wasMuted,
        },
      });
    }
    this.applyVolumes();
  }

  // ── 내부 ──

  private async requestJoin(channelId: string): Promise<VoiceJoinResult> {
    const socket = await this.connectedSocket();
    const ack = await socket
      .timeout(REQUEST_TIMEOUT_MS)
      .emitWithAck(SocketEvent.VoiceJoin, { channelId });
    if (!ack.ok) throw new Error(ack.error);
    return ack.data;
  }

  /** 실시간 연결을 잠깐 기다린다 (앱을 막 켰거나 다시 연결하는 중) */
  private async connectedSocket(): Promise<AppSocket> {
    const socket = this.socket;
    if (!socket) throw new Error('서버에 연결되어 있지 않습니다.');
    if (socket.connected) return socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off('connect', onConnect);
        reject(new Error('서버에 연결되어 있지 않습니다.'));
      }, REQUEST_TIMEOUT_MS);
      const onConnect = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.once('connect', onConnect);
    });
    return socket;
  }

  private async connect(channelId: string, { url, token }: VoiceJoinResult): Promise<void> {
    // LiveKit(WebRTC 네이티브 모듈)은 처음 통화에 들어갈 때 불러온다. 불러오지 못하면(네이티브 모듈이 없는
    // 예전 빌드) 서버에 들어간 것도 되돌린다: 그러지 않으면 통화 목록에 남는다.
    let VoiceConnection: typeof import('./connection').VoiceConnection;
    try {
      ({ VoiceConnection } = await import('./connection'));
    } catch {
      this.socket?.emit(SocketEvent.VoiceLeave, {});
      throw new Error('이 앱 버전에서는 음성 통화를 쓸 수 없습니다. 앱을 업데이트해 주세요.');
    }
    if (store().session?.channelId !== channelId) return;
    const conn = new VoiceConnection({
      onSpeaking: (value) => this.onSpeaking(value),
      onReconnecting: () => this.setStatus('reconnecting'),
      onReconnected: () => this.setStatus('connected'),
      onDropped: (reason) => {
        if (this.connection !== conn) return;
        this.connection = null;
        store().setSession(null);
        store().patch({
          gains: {},
          watching: null,
          error:
            reason === 'duplicate'
              ? '다른 곳에서 이 통화에 들어가 여기서는 연결을 끊었습니다.'
              : '음성 연결이 끊어졌습니다.',
        });
      },
      onScreen: (identity, streamUrl) => {
        if (this.connection !== conn) return;
        const { watching } = store();
        if (watching?.userId === identity) store().patch({ watching: { ...watching, streamUrl } });
      },
    });
    this.connection = conn;
    const { muted, deafened } = store();
    const wantMic = !muted && !deafened;
    try {
      const allowed = !wantMic || this.micAllowed;
      const micOk = await conn.connect(url, token, wantMic && allowed);
      if (this.connection !== conn) return;
      store().setSession({ channelId, status: 'connected', listenOnly: !micOk || !allowed });
      // 앱을 내리거나 화면을 꺼도 통화가 이어지게 (마이크 권한이 있어야 켤 수 있다)
      if (allowed) startCallService('MetaCode 통화 중', '눌러서 앱으로 돌아가기');
      this.applyVolumes();
      this.sendState();
    } catch {
      if (this.connection !== conn) return;
      await this.dropConnection();
      this.socket?.emit(SocketEvent.VoiceLeave, {});
      store().setSession(null);
      store().patch({ error: '음성 서버에 연결하지 못했습니다.' });
    }
  }

  private async dropConnection(keepWatch = false): Promise<void> {
    const current = this.connection;
    this.connection = null;
    this.speaking = false;
    stopCallService();
    if (!keepWatch) store().patch({ watching: null });
    await current?.disconnect();
  }

  /** 말하기 시작했거나 멈췄다. 내 화면에는 바로 보이고, 다른 사람에게는 서버로 알린다 */
  private onSpeaking(value: boolean) {
    if (this.speaking === value) return;
    this.speaking = value;
    const { session, calls } = store();
    if (!session) return;
    const me = calls[session.channelId]?.members.find((m) => m.user.id === this.meId);
    if (me) store().upsertMember(session.channelId, { ...me, speaking: value });
    this.sendState();
  }

  /** 이 기기로 통화 중이면 내 말하는 중은 이 기기의 값이 기준이다 (서버가 되돌려 준 값은 조금 전의 것) */
  private withLocalSpeaking(channelId: string, member: VoiceMember): VoiceMember {
    const mine =
      member.user.id === this.meId && this.connection && store().session?.channelId === channelId;
    return mine ? { ...member, speaking: this.speaking } : member;
  }

  private setStatus(status: 'connected' | 'reconnecting') {
    const { session } = store();
    if (session && session.status !== 'connecting') store().setSession({ ...session, status });
  }

  /** 내 상태를 서버에 알린다 (다른 사람의 목록과 광장에 보인다) */
  private sendState() {
    const { session, muted, deafened } = store();
    if (!session || session.status === 'connecting') return;
    this.socket?.emit(SocketEvent.VoiceUpdate, {
      muted: muted || session.listenOnly,
      deafened,
      speaking: this.speaking,
      sharing: false,
    });
  }

  private applyVolumes() {
    const { session, calls, deafened, gains, watching } = store();
    if (!session) return;
    const proximity = calls[session.channelId]?.proximity ?? false;
    this.connection?.applyVolumes((identity, kind) =>
      trackVolume(identity, kind, {
        deafened,
        proximity,
        gains,
        watching: watching?.userId ?? null,
        previewing: null,
      }),
    );
  }

  private putCall(call: VoiceCall) {
    const others = Object.values(store().calls).filter((c) => c.channelId !== call.channelId);
    store().setCalls([...others, call]);
  }
}
