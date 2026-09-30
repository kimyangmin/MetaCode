import {
  DisconnectReason,
  LocalAudioTrack,
  type LocalParticipant,
  type LocalTrackPublication,
  ParticipantEvent,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import type { TrackKind } from '@metacode/client';
import type { Sensitivity } from './gate';
import {
  MIC_SAMPLE_RATE,
  type MicSettings,
  MicProcessor,
  captureConstraints,
  micReports,
} from './micChain';
import type { GateMessage } from './micGate.worklet';
import {
  DEFAULT_SCREEN_QUALITY,
  type ScreenQuality,
  captureOptions,
  publishOptions,
} from './screenQuality';
import { SPEECH_RELEASE_MS, SpeechDetector } from './speech';

export interface ConnectionHandlers {
  /** 내가 말하기 시작하거나 멈췄다 (마이크 음량으로 직접 감지) */
  onSpeaking(speaking: boolean): void;
  onReconnecting(): void;
  onReconnected(): void;
  /** 내가 끊지 않았는데 끊겼다. 같은 사람이 다른 곳에서 들어오면 duplicate */
  onDropped(reason: 'duplicate' | 'other'): void;
  /** 브라우저가 소리 재생을 막았다 (사용자가 한 번 눌러야 한다) */
  onPlaybackBlocked(blocked: boolean): void;
  /** 보고 있는 사람의 화면 공유 영상을 받기 시작했거나(stream) 끊겼다(null) */
  onScreen(identity: string, stream: MediaStream | null): void;
  /** 내 화면 공유가 끝났다 (브라우저의 "공유 중지"를 눌렀거나 공유하던 창이 닫힘) */
  onScreenShareEnded(): void;
}

export interface ConnectOptions {
  micEnabled: boolean;
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  /** 마이크 처리: 잡음 제거, 증폭, 입력 감도 */
  mic: MicSettings;
}

/** 트랙 종류별 구독 여부와 음량. 0이면 구독하지 않는다 */
export type VolumePolicy = (identity: string, kind: TrackKind) => number;

const kindOf = (source: Track.Source): TrackKind | null => {
  if (source === Track.Source.Microphone) return 'microphone';
  if (source === Track.Source.ScreenShare) return 'screen';
  if (source === Track.Source.ScreenShareAudio) return 'screen-audio';
  return null;
};

/**
 * 통화 하나의 LiveKit 연결. 자동 구독은 끄고, 무엇을 얼마나 크게 받을지는 applyVolumes로 정한다
 * (근접 음성: 들리지 않는 사람은 구독하지 않아 대역폭도 아낀다. 화면 공유: 보고 있는 것만 받는다).
 * 받은 소리는 화면에 보이지 않는 <audio>로 틀고, 화면 공유 영상은 onScreen으로 넘긴다.
 *
 * 보내는 마이크는 MicProcessor(micChain.ts)를 거친다: RNNoise 잡음 제거 → 소리 문턱 → 증폭.
 * 말하는 중은 그 처리 줄이 잰 음량과 문턱으로 판단한다 (SpeechDetector, 문턱과 같은 기준이라
 * 초록 테두리가 켜진 동안만 소리가 나간다). LiveKit의 음성 감지는 서버가 음량을 모아 판정해서
 * 1초쯤 늦으므로, 처리기를 쓸 수 없을 때(AudioWorklet 불가, AudioContext가 멈춤)에만 쓴다.
 */
export class VoiceConnection {
  private readonly room = new Room({
    adaptiveStream: false,
    dynacast: false,
    audioCaptureDefaults: captureConstraints({ noiseSuppression: false }),
  });
  private readonly audioHost = document.createElement('div');
  /** 트랙별로 붙인 <audio>. 구독을 끊을 때 LiveKit이 먼저 떼어 내므로 직접 기억해서 지운다 */
  private readonly elements = new Map<string, HTMLMediaElement>();
  /**
   * 받고 있는 화면 공유 영상 (사람별). 미리보기로 이미 받고 있던 영상을 크게 볼 때처럼,
   * 구독이 새로 생기지 않아도 지금 받는 영상을 바로 넘겨줄 수 있게 기억해 둔다.
   */
  private readonly screens = new Map<string, MediaStream>();
  /** 음량을 정하기 전에는 아무것도 구독하지 않는다 (근접 음성에서 먼 사람이 잠깐 들리지 않게) */
  private policy: VolumePolicy = () => 0;
  private leaving = false;
  private mic: MicSettings = {
    noiseSuppression: false,
    gain: 1,
    sensitivity: { mode: 'auto', thresholdDb: -50 },
  };
  /** 마이크 처리기 (붙이지 못했으면 null, 다시 시도하지 않는다) */
  private processor: MicProcessor | null = null;
  private processorFailed = false;
  /** 보내는 마이크가 켜져 있다 (꺼져 있으면 처리기의 음량으로 말하는 중을 켜지 않는다) */
  private micOn = false;
  private audioContext: AudioContext | null = null;
  private readonly speech = new SpeechDetector();
  private fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly handlers: ConnectionHandlers) {
    this.audioHost.hidden = true;
    document.body.append(this.audioHost);

    this.room
      .on(RoomEvent.TrackPublished, (publication, participant) =>
        this.applyTo(participant, publication),
      )
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant) => {
        if (!track.sid) return;
        if (track.kind === Track.Kind.Video) {
          const stream = new MediaStream([track.mediaStreamTrack]);
          this.screens.set(participant.identity, stream);
          handlers.onScreen(participant.identity, stream);
          return;
        }
        const element = track.attach();
        this.elements.set(track.sid, element);
        this.audioHost.append(element);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _publication, participant) => {
        track.detach();
        if (track.kind === Track.Kind.Video) {
          this.screens.delete(participant.identity);
          handlers.onScreen(participant.identity, null);
        }
        if (!track.sid) return;
        this.elements.get(track.sid)?.remove();
        this.elements.delete(track.sid);
      })
      .on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
        if (publication.source === Track.Source.ScreenShare) handlers.onScreenShareEnded();
      })
      // 장치가 바뀌면(고르거나 뽑혀서) 마이크 트랙이 새로 만들어진다.
      .on(RoomEvent.ActiveDeviceChanged, (kind: MediaDeviceKind) => {
        if (kind === 'audioinput') this.stopSpeaking();
      })
      .on(RoomEvent.Reconnecting, () => handlers.onReconnecting())
      .on(RoomEvent.Reconnected, () => handlers.onReconnected())
      .on(RoomEvent.AudioPlaybackStatusChanged, () =>
        handlers.onPlaybackBlocked(!this.room.canPlaybackAudio),
      )
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        this.cleanup();
        if (!this.leaving) {
          handlers.onDropped(
            reason === DisconnectReason.DUPLICATE_IDENTITY ? 'duplicate' : 'other',
          );
        }
      });
    this.localParticipant.on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) => {
      if (!this.measuring) this.onFallbackSpeaking(speaking);
    });
  }

  private get localParticipant(): LocalParticipant {
    return this.room.localParticipant;
  }

  /** 들어간다. 마이크를 쓸 수 없으면 듣기만 하고 false를 돌려준다 */
  async connect(url: string, token: string, options: ConnectOptions): Promise<boolean> {
    await this.room.connect(url, token, { autoSubscribe: false });
    if (options.outputDeviceId) {
      await this.room.switchActiveDevice('audiooutput', options.outputDeviceId).catch(() => {});
    }
    this.applyAll();
    this.handlers.onPlaybackBlocked(!this.room.canPlaybackAudio);
    this.mic = { ...options.mic };
    return this.setMicEnabled(options.micEnabled, options.inputDeviceId);
  }

  /** 마이크 켜기/끄기. 켜려는데 장치가 없거나 권한이 없으면 false */
  async setMicEnabled(enabled: boolean, deviceId: string | null): Promise<boolean> {
    this.micOn = false;
    this.stopSpeaking();
    try {
      await this.localParticipant.setMicrophoneEnabled(enabled, {
        ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
        ...captureConstraints(this.mic),
      });
      if (enabled) await this.attachProcessor();
      this.micOn = enabled;
      return true;
    } catch {
      return !enabled;
    }
  }

  /** 마이크 증폭을 바꾼다 (통화 중이면 바로 적용) */
  setInputGain(value: number): void {
    this.mic = { ...this.mic, gain: value };
    this.processor?.setGain(value);
  }

  /** 입력 감도(소리 문턱)를 바꾼다 */
  setSensitivity(sensitivity: Sensitivity): void {
    this.mic = { ...this.mic, sensitivity };
    this.processor?.setSensitivity(sensitivity);
  }

  /**
   * 잡음 제거 켜기/끄기. 처리 줄에서 RNNoise를 넣거나 빼고, 브라우저 잡음 억제는 그 반대로 바꾼다
   * (마이크 트랙을 새 조건으로 다시 연다. LiveKit이 처리기도 다시 붙인다).
   */
  async setNoiseSuppression(on: boolean): Promise<void> {
    this.mic = { ...this.mic, noiseSuppression: on };
    await this.processor?.setNoiseSuppression(on);
    const track = this.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    if (track instanceof LocalAudioTrack && !track.isMuted) {
      const deviceId = track.mediaStreamTrack.getSettings().deviceId;
      await track
        .restartTrack({
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          ...captureConstraints(this.mic),
        })
        .catch(() => {});
    }
  }

  /** 잡음 제거를 켰지만 불러오지 못했다 (오래된 브라우저 등) */
  get denoiseFailed(): boolean {
    return this.processor?.denoiseFailed ?? false;
  }

  /** 처리기의 음량으로 말하는 중을 판단한다 (아니면 LiveKit의 음성 감지를 쓴다) */
  private get measuring(): boolean {
    return !!this.processor && this.micOn && this.audioContext?.state === 'running';
  }

  /** 처리기가 20ms마다 알려 주는 음량과 문턱 */
  private readonly onReport = (message: GateMessage) => {
    micReports.publish(message);
    if (!this.micOn) return;
    // 문턱이 닫혀 있으면(목소리가 아닌 소리 포함) 말하는 중으로 보지 않는다: 초록 테두리 = 실제로 나가는 소리.
    const level = message.open ? message.level : -100;
    const changed = this.speech.push(level, message.time, message.threshold);
    if (changed !== null) this.handlers.onSpeaking(changed);
  };

  private stopSpeaking() {
    clearTimeout(this.fallbackTimer);
    this.speech.reset();
    this.handlers.onSpeaking(false);
  }

  /** LiveKit의 음성 감지 (직접 잴 수 없을 때). 멈춤은 단어 사이에 깜빡이지 않게 늦춘다 */
  private onFallbackSpeaking(speaking: boolean) {
    clearTimeout(this.fallbackTimer);
    if (speaking) this.handlers.onSpeaking(true);
    else this.fallbackTimer = setTimeout(() => this.handlers.onSpeaking(false), SPEECH_RELEASE_MS);
  }

  /** 마이크 트랙에 처리기(잡음 제거 → 문턱 → 증폭)를 붙인다. 실패하면 처리 없이 보낸다 */
  private async attachProcessor() {
    const track = this.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    if (!(track instanceof LocalAudioTrack) || this.processorFailed) return;
    this.processor ??= new MicProcessor(this.mic, this.onReport);
    if (track.getProcessor() === this.processor) return;
    this.audioContext ??= new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    if (this.audioContext.state === 'suspended') await this.audioContext.resume().catch(() => {});
    track.setAudioContext(this.audioContext);
    try {
      await track.setProcessor(this.processor);
    } catch {
      this.processorFailed = true;
      this.processor = null;
    }
  }

  /**
   * 화면 공유 켜기/끄기. 켤 때는 브라우저(또는 데스크톱 앱이 미리 고른 화면)의 선택을 따르고,
   * 가능하면 시스템 소리도 함께 보낸다. 화질은 screenQuality.ts. 사용자가 취소했거나 실패하면 false
   */
  async setScreenShareEnabled(
    enabled: boolean,
    quality: ScreenQuality = DEFAULT_SCREEN_QUALITY,
  ): Promise<boolean> {
    try {
      await this.localParticipant.setScreenShareEnabled(
        enabled,
        captureOptions(quality),
        publishOptions(quality),
      );
      return true;
    } catch {
      return false;
    }
  }

  /** 지금 받고 있는 이 사람의 화면 공유 영상 (받고 있지 않으면 null) */
  screenOf(identity: string): MediaStream | null {
    return this.screens.get(identity) ?? null;
  }

  /** 내가 공유 중인 화면 (내 화면을 미리 볼 때) */
  localScreen(): MediaStream | null {
    const track = this.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
    return track ? new MediaStream([track.mediaStreamTrack]) : null;
  }

  /** 무엇을 얼마나 크게 받을지 정한다. 0이면 구독을 끊는다 */
  applyVolumes(policy: VolumePolicy): void {
    this.policy = policy;
    this.applyAll();
  }

  private applyAll() {
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        this.applyTo(participant, publication);
      }
    }
  }

  private applyTo(participant: RemoteParticipant, publication: RemoteTrackPublication) {
    const kind = kindOf(publication.source);
    if (!kind) return;
    const volume = this.policy(participant.identity, kind);
    // isDesired: 구독을 요청해 둔 상태 (아직 연결 중이어도 true). isSubscribed로 보면 요청 중인 구독을 끊지 못한다.
    if (volume <= 0) {
      if (publication.isDesired) publication.setSubscribed(false);
      return;
    }
    if (!publication.isDesired) publication.setSubscribed(true);
    if (kind === 'microphone') participant.setVolume(volume, Track.Source.Microphone);
    if (kind === 'screen-audio') participant.setVolume(volume, Track.Source.ScreenShareAudio);
  }

  async switchDevice(kind: 'audioinput' | 'audiooutput', deviceId: string): Promise<boolean> {
    const ok = await this.room.switchActiveDevice(kind, deviceId).catch(() => false);
    if (kind === 'audioinput') this.stopSpeaking();
    return ok;
  }

  /** 브라우저가 소리 재생을 막았을 때, 사용자가 누른 버튼에서 부른다 */
  startAudio(): Promise<void> {
    return this.room.startAudio();
  }

  async disconnect(): Promise<void> {
    this.leaving = true;
    await this.room.disconnect();
    this.cleanup();
  }

  private cleanup() {
    this.elements.clear();
    this.screens.clear();
    this.audioHost.remove();
    clearTimeout(this.fallbackTimer);
    this.micOn = false;
    void this.processor?.destroy();
    this.processor = null;
    void this.audioContext?.close().catch(() => {});
    this.audioContext = null;
  }
}
