import {
  SocketEvent,
  type VoiceCall,
  type VoiceGains,
  type VoiceJoinResult,
  type VoiceJoined,
  type VoiceLeft,
  type VoiceProximityChanged,
} from '@metacode/shared';
import type { AppSocket } from '../../realtime/RealtimeProvider';
import { trackVolume } from './calls';
import type { VoiceConnection } from './connection';
import { useVoiceStore } from './store';

const REQUEST_TIMEOUT_MS = 10_000;
/** 말을 멈췄다고 알리기 전에 기다리는 시간 (단어 사이에 깜빡이지 않게) */
const SPEAKING_RELEASE_MS = 300;

const store = useVoiceStore.getState;

/**
 * 음성 통화 제어: 진행 중인 통화 목록을 서버 이벤트로 유지하고, 내 통화의 LiveKit 연결을 관리한다.
 * 상태는 useVoiceStore에 두고 화면은 그것을 읽는다.
 */
export class VoiceController {
  private socket: AppSocket | null = null;
  private connection: VoiceConnection | null = null;
  private speaking = false;
  private speakingTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly meId: string) {}

  /** 실시간 연결에 붙는다. 떼어 낼 함수를 돌려준다 */
  attach(socket: AppSocket): () => void {
    this.socket = socket;
    const resync = () => void this.resync();
    const onMember = ({ channelId, member }: VoiceJoined) =>
      store().upsertMember(channelId, member);
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
    useVoiceStore.setState({ session: null, calls: {}, gains: {}, error: null });
    this.closeScreens();
  }

  /**
   * 통화 목록을 새로 받는다 (접속, 재접속, 커뮤니티가 바뀔 때).
   * 통화 중이면 서버에 이 연결로 다시 묶는다 (서버는 통화를 실시간 연결에 묶어 둔다).
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

  async join(channelId: string): Promise<void> {
    if (store().session?.channelId === channelId) return;
    await this.dropConnection();
    store().setSession({ channelId, status: 'connecting', listenOnly: false });
    store().patch({ error: null, gains: {} });
    try {
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
    const { muted, deafened, session, inputDeviceId } = store();
    // 듣기만 하던 중이면 마이크를 다시 켜 본다.
    const next = session?.listenOnly ? false : !muted;
    // 헤드셋이 꺼진 채로 마이크를 켜면 헤드셋도 켠다 (말하는데 못 듣는 상태를 막는다).
    store().patch({ muted: next, deafened: next ? deafened : false });
    if (this.connection && session) {
      const ok = await this.connection.setMicEnabled(!next, inputDeviceId);
      store().setSession({ ...session, listenOnly: !ok });
      this.applyVolumes();
    }
    this.sendState();
  }

  async toggleDeafen(): Promise<void> {
    const { muted, deafened, session, inputDeviceId } = store();
    const next = !deafened;
    store().patch({ deafened: next });
    // 헤드셋을 끄면 마이크도 끈다 (Discord와 같이). 다시 켜면 원래 음소거 상태로 돌아간다.
    await this.connection?.setMicEnabled(!next && !muted && !session?.listenOnly, inputDeviceId);
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

  async switchDevice(kind: 'audioinput' | 'audiooutput', deviceId: string): Promise<void> {
    store().setDevice(kind, deviceId);
    await this.connection?.switchDevice(kind, deviceId);
  }

  /**
   * 내 화면 공유 시작. 브라우저는 고르는 창을 띄우고, 데스크톱 앱은 미리 고른 화면을 쓴다.
   * 취소했거나 실패하면 false
   */
  async startScreenShare(): Promise<boolean> {
    const conn = this.connection;
    if (!conn || store().sharing) return false;
    const ok = await conn.setScreenShareEnabled(true);
    if (!ok || this.connection !== conn) return false;
    store().patch({ sharing: true });
    this.sendState();
    return true;
  }

  async stopScreenShare(): Promise<void> {
    if (!store().sharing) return;
    store().patch({ sharing: false });
    await this.connection?.setScreenShareEnabled(false);
    if (store().watching === this.meId) store().patch({ watching: null, screen: null });
    this.sendState();
  }

  /**
   * 누군가의 화면 공유 보기. 그 통화에 없으면 먼저 들어간다 (Discord처럼 통화 참여자만 볼 수 있다).
   * null이면 보기를 닫는다 (영상 구독도 끊는다).
   */
  async watch(channelId: string | null, userId: string | null): Promise<void> {
    if (channelId && userId && store().session?.channelId !== channelId) {
      await this.join(channelId);
      if (store().session?.channelId !== channelId) return;
    }
    store().patch({ watching: userId, screen: null });
    // 내 화면은 받을 필요 없이 올리고 있는 것을 그대로 보여 준다.
    if (userId === this.meId) store().patch({ screen: this.connection?.localScreen() ?? null });
    this.applyVolumes();
  }

  /**
   * 마우스를 올린 동안 화면 공유를 작게 미리 본다 (같은 통화에 있을 때만, 영상만 받는다).
   * null이면 미리보기를 닫고 구독을 끊는다.
   */
  preview(userId: string | null): void {
    if (store().previewing === userId) return;
    const self = userId === this.meId;
    store().patch({
      previewing: userId,
      previewScreen: self ? (this.connection?.localScreen() ?? null) : null,
    });
    this.applyVolumes();
  }

  /** 브라우저가 소리 재생을 막았을 때 사용자가 누른 버튼에서 부른다 */
  startAudio(): void {
    void this.connection?.startAudio().then(() => store().patch({ playbackBlocked: false }));
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

  /** 실시간 연결을 잠깐 기다린다 (페이지를 막 열었거나 다시 연결하는 중) */
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
    // LiveKit 클라이언트는 크기가 커서 처음 통화에 들어갈 때 불러온다.
    const { VoiceConnection } = await import('./connection');
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
          playbackBlocked: false,
          error:
            reason === 'duplicate'
              ? '다른 곳에서 이 통화에 들어가 여기서는 연결을 끊었습니다.'
              : '음성 연결이 끊어졌습니다.',
        });
      },
      onPlaybackBlocked: (blocked) => store().patch({ playbackBlocked: blocked }),
      onScreen: (identity, stream) => {
        if (this.connection !== conn) return;
        if (store().watching === identity) store().patch({ screen: stream });
        if (store().previewing === identity) store().patch({ previewScreen: stream });
      },
      onScreenShareEnded: () => {
        if (this.connection !== conn || !store().sharing) return;
        store().patch({ sharing: false });
        if (store().watching === this.meId) store().patch({ watching: null, screen: null });
        this.sendState();
      },
    });
    this.connection = conn;
    const { muted, deafened, inputDeviceId, outputDeviceId } = store();
    try {
      const micOk = await conn.connect(url, token, {
        micEnabled: !muted && !deafened,
        inputDeviceId,
        outputDeviceId,
      });
      if (this.connection !== conn) return;
      store().setSession({ channelId, status: 'connected', listenOnly: !micOk });
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

  private async dropConnection(): Promise<void> {
    const current = this.connection;
    this.connection = null;
    this.speaking = false;
    clearTimeout(this.speakingTimer);
    store().patch({ playbackBlocked: false });
    this.closeScreens();
    await current?.disconnect();
  }

  private closeScreens() {
    store().patch({
      sharing: false,
      watching: null,
      screen: null,
      previewing: null,
      previewScreen: null,
    });
  }

  private onSpeaking(value: boolean) {
    clearTimeout(this.speakingTimer);
    const apply = () => {
      if (this.speaking === value) return;
      this.speaking = value;
      this.sendState();
    };
    if (value) apply();
    else this.speakingTimer = setTimeout(apply, SPEAKING_RELEASE_MS);
  }

  private setStatus(status: 'connected' | 'reconnecting') {
    const { session } = store();
    if (session && session.status !== 'connecting') store().setSession({ ...session, status });
  }

  /** 내 상태를 서버에 알린다 (다른 사람의 목록과 광장에 보인다) */
  private sendState() {
    const { session, muted, deafened, sharing } = store();
    if (!session || session.status === 'connecting') return;
    this.socket?.emit(SocketEvent.VoiceUpdate, {
      muted: muted || session.listenOnly,
      deafened,
      speaking: this.speaking,
      sharing,
    });
  }

  private applyVolumes() {
    const { session, calls, deafened, gains, watching, previewing } = store();
    if (!session) return;
    const proximity = calls[session.channelId]?.proximity ?? false;
    this.connection?.applyVolumes((identity, kind) =>
      trackVolume(identity, kind, { deafened, proximity, gains, watching, previewing }),
    );
  }

  private putCall(call: VoiceCall) {
    const others = Object.values(store().calls).filter((c) => c.channelId !== call.channelId);
    store().setCalls([...others, call]);
  }
}
