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
import type { AppSocket } from '../../realtime/RealtimeProvider';
import { trackVolume } from './calls';
import type { VoiceConnection } from './connection';
import type { Sensitivity } from './gate';
import type { ScreenQuality } from './screenQuality';
import { useVoiceStore } from './store';

const REQUEST_TIMEOUT_MS = 10_000;

const store = useVoiceStore.getState;

/**
 * 음성 통화 제어: 진행 중인 통화 목록을 서버 이벤트로 유지하고, 내 통화의 LiveKit 연결을 관리한다.
 * 상태는 useVoiceStore에 두고 화면은 그것을 읽는다.
 */
export class VoiceController {
  private socket: AppSocket | null = null;
  private connection: VoiceConnection | null = null;
  /** 내가 말하는 중 (이 기기의 마이크로 직접 감지한 값) */
  private speaking = false;
  /** 화면 보기 요청 번호 (watch) */
  private watchRequest = 0;

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

  /** keepWatch: 화면을 보려고 들어가는 중이라 보기 창을 닫지 않는다 (watch) */
  async join(channelId: string, keepWatch = false): Promise<void> {
    if (store().session?.channelId === channelId) return;
    await this.dropConnection(keepWatch);
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

  /** 마이크 증폭 (0~2, 1이 원래 크기). 기억하고 통화 중이면 바로 적용한다 */
  setInputGain(value: number): void {
    store().setInputGain(value);
    this.connection?.setInputGain(value);
  }

  /** RNNoise 잡음 제거 켜기/끄기. 기억하고 통화 중이면 바로 적용한다 */
  async setNoiseSuppression(on: boolean): Promise<void> {
    store().setNoiseSuppression(on);
    await this.connection?.setNoiseSuppression(on);
  }

  /** 입력 감도(자동 또는 직접 정한 문턱). 기억하고 통화 중이면 바로 적용한다 */
  setSensitivity(sensitivity: Sensitivity): void {
    store().setSensitivity(sensitivity);
    this.connection?.setSensitivity(store().sensitivity);
  }

  /** 들리는 소리 전체의 크기 (0~1). 기억하고 통화 중이면 바로 적용한다 */
  setOutputVolume(value: number): void {
    store().setOutputVolume(value);
    this.applyVolumes();
  }

  async switchDevice(kind: 'audioinput' | 'audiooutput', deviceId: string): Promise<void> {
    store().setDevice(kind, deviceId);
    await this.connection?.switchDevice(kind, deviceId);
  }

  /**
   * 내 화면 공유 시작. 브라우저는 고르는 창을 띄우고, 데스크톱 앱은 미리 고른 화면을 쓴다.
   * 취소했거나 실패하면 false
   */
  async startScreenShare(quality: ScreenQuality): Promise<boolean> {
    const conn = this.connection;
    if (!conn || store().sharing) return false;
    const ok = await conn.setScreenShareEnabled(true, quality);
    if (!ok || this.connection !== conn) return false;
    store().patch({ sharing: true });
    this.sendState();
    return true;
  }

  async stopScreenShare(): Promise<void> {
    if (!store().sharing) return;
    store().patch({ sharing: false });
    await this.connection?.setScreenShareEnabled(false);
    if (store().watching === this.meId) {
      store().patch({ watching: null, watchChannel: null, screen: null });
    }
    this.sendState();
  }

  /**
   * 누군가의 화면 공유 보기. 그 통화에 없으면 먼저 들어간다 (Discord처럼 통화 참여자만 볼 수 있다).
   * - 보기 창은 바로 띄운다 (들어가는 동안 "통화에 들어가는 중", 실패하면 그 사유).
   * - 보려고 들어갈 때는 마이크를 끈 채로 들어간다 (말하려던 게 아니므로). 보기 창에서 바로 켤 수 있다.
   * null이면 보기를 닫는다 (영상 구독도 끊는다).
   */
  async watch(channelId: string | null, userId: string | null): Promise<void> {
    // 들어가는 사이 사용자가 창을 닫았거나 다른 화면을 골랐는지 가리려고 요청마다 번호를 붙인다.
    const request = ++this.watchRequest;
    if (!channelId || !userId) {
      store().patch({
        watching: null,
        watchChannel: null,
        screen: null,
        watchError: null,
        watchJoining: false,
        watchMutedOnJoin: false,
      });
      this.applyVolumes();
      return;
    }
    const joining = store().session?.channelId !== channelId;
    store().patch({
      watching: userId,
      watchChannel: channelId,
      screen: joining ? null : this.currentScreen(userId),
      watchError: null,
      watchJoining: joining,
      ...(joining ? {} : { watchMutedOnJoin: false }),
    });
    if (joining) {
      const wasMuted = store().muted;
      store().patch({ muted: true, watchMutedOnJoin: !wasMuted });
      await this.join(channelId, true);
      // 기다리는 사이 다른 것을 보기로 했거나 닫았다.
      if (request !== this.watchRequest) return;
      if (store().session?.channelId !== channelId) {
        // 들어가지 못했다: 마이크 상태를 되돌리고 보기 창에 사유를 보여 준다.
        store().patch({
          muted: wasMuted,
          watching: userId,
          watchChannel: channelId,
          watchError: store().error ?? '통화에 들어가지 못했습니다.',
          watchJoining: false,
          watchMutedOnJoin: false,
        });
        return;
      }
      store().patch({ screen: this.currentScreen(userId), watchJoining: false });
    }
    this.applyVolumes();
  }

  /**
   * 보기 창의 "다시 시도": 들어가지 못했으면 다시 들어가 보고, 영상이 오지 않으면 구독을 끊었다 다시 건다.
   */
  retryWatch(): void {
    const { watching, watchChannel, watchError } = store();
    if (!watching || !watchChannel) return;
    if (watchError) {
      void this.watch(watchChannel, watching);
      return;
    }
    store().patch({ watching: null });
    this.applyVolumes();
    store().patch({ watching, screen: this.currentScreen(watching) });
    this.applyVolumes();
  }

  /**
   * 마우스를 올린 동안 화면 공유를 작게 미리 본다 (같은 통화에 있을 때만, 영상만 받는다).
   * null이면 미리보기를 닫고 구독을 끊는다.
   */
  preview(userId: string | null): void {
    if (store().previewing === userId) return;
    store().patch({ previewing: userId, previewScreen: this.currentScreen(userId) });
    this.applyVolumes();
  }

  /**
   * 지금 바로 보여 줄 수 있는 화면 영상: 내 화면은 올리고 있는 것, 다른 사람은 이미 받고 있는 것.
   * 미리보기로 받던 영상을 LIVE로 크게 볼 때는 구독이 새로 생기지 않아서, 여기서 넘겨주지 않으면
   * "불러오는 중"에서 멈춘다.
   */
  private currentScreen(userId: string | null): MediaStream | null {
    if (!userId) return null;
    if (userId === this.meId) return this.connection?.localScreen() ?? null;
    return this.connection?.screenOf(userId) ?? null;
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
        // 보던 화면 창도 닫는다 (남겨 두면 다음 통화에 들어갈 때 다시 떴다).
        this.closeScreens();
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
        if (store().watching === this.meId) {
          store().patch({ watching: null, watchChannel: null, screen: null });
        }
        this.sendState();
      },
    });
    this.connection = conn;
    const { muted, deafened, inputDeviceId, outputDeviceId, inputGain } = store();
    const { noiseSuppression, sensitivity } = store();
    try {
      const micOk = await conn.connect(url, token, {
        micEnabled: !muted && !deafened,
        inputDeviceId,
        outputDeviceId,
        mic: { noiseSuppression, gain: inputGain, sensitivity },
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

  private async dropConnection(keepWatch = false): Promise<void> {
    const current = this.connection;
    this.connection = null;
    this.speaking = false;
    store().patch({ playbackBlocked: false });
    this.closeScreens(keepWatch);
    await current?.disconnect();
  }

  /** keepWatch: 화면을 보려고 다른 통화로 옮기는 중이면 보기 창은 그대로 둔다 (영상만 비움) */
  private closeScreens(keepWatch = false) {
    store().patch({
      sharing: false,
      screen: null,
      previewing: null,
      previewScreen: null,
      ...(keepWatch
        ? {}
        : {
            watching: null,
            watchChannel: null,
            watchError: null,
            watchJoining: false,
            watchMutedOnJoin: false,
          }),
    });
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

  /**
   * 이 기기로 통화 중이면 내 말하는 중은 직접 감지한 값이 기준이다.
   * 서버가 되돌려 준 값은 조금 전의 것이라, 그대로 쓰면 내 표시가 잠깐 거꾸로 바뀐다.
   */
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
    const { session, calls, deafened, gains, watching, previewing, outputVolume } = store();
    if (!session) return;
    const proximity = calls[session.channelId]?.proximity ?? false;
    this.connection?.applyVolumes((identity, kind) => {
      const volume = trackVolume(identity, kind, {
        deafened,
        proximity,
        gains,
        watching,
        previewing,
      });
      // 출력 음량은 소리에만 곱한다 (화면 공유 영상은 음량이 아니라 구독 여부).
      return kind === 'screen' ? volume : volume * outputVolume;
    });
  }

  private putCall(call: VoiceCall) {
    const others = Object.values(store().calls).filter((c) => c.channelId !== call.channelId);
    store().setCalls([...others, call]);
  }
}
