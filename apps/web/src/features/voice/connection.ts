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
import type { TrackKind } from './calls';
import { MicGainProcessor } from './micGain';
import { MicLevelMeter } from './micLevel';
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
  /** 마이크 증폭 (1이 원래 크기) */
  inputGain: number;
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
 * 말하는 중은 보내는 마이크 트랙의 음량을 직접 재서 판단한다 (MicLevelMeter + SpeechDetector).
 * LiveKit의 음성 감지는 서버가 음량을 모아 판정한 뒤 알려 주는 것이라 1초쯤 늦어서,
 * 직접 잴 수 없을 때(AudioWorklet 불가, AudioContext가 멈춤)에만 쓴다.
 */
export class VoiceConnection {
  private readonly room = new Room({
    adaptiveStream: false,
    dynacast: false,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
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
  /** 마이크 증폭. 1(원래 크기)이면 처리기를 붙이지 않는다 */
  private inputGain = 1;
  private micGain: MicGainProcessor | null = null;
  private audioContext: AudioContext | null = null;
  private readonly speech = new SpeechDetector();
  private meter: MicLevelMeter | null = null;
  /** 측정기를 만드는 중이거나 만들지 못했다 (못 만들었으면 다시 시도하지 않는다) */
  private meterState: 'none' | 'loading' | 'failed' = 'none';
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
        if (kind === 'audioinput') void this.syncMeter();
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
    this.inputGain = options.inputGain;
    return this.setMicEnabled(options.micEnabled, options.inputDeviceId);
  }

  /** 마이크 켜기/끄기. 켜려는데 장치가 없거나 권한이 없으면 false */
  async setMicEnabled(enabled: boolean, deviceId: string | null): Promise<boolean> {
    try {
      await this.localParticipant.setMicrophoneEnabled(
        enabled,
        deviceId ? { deviceId: { ideal: deviceId } } : undefined,
      );
      if (enabled) await this.applyGain();
      await this.syncMeter();
      return true;
    } catch {
      await this.syncMeter();
      return !enabled;
    }
  }

  /** 마이크 증폭을 바꾼다 (통화 중이면 바로 적용) */
  async setInputGain(value: number): Promise<void> {
    this.inputGain = value;
    await this.applyGain();
    // 증폭 처리기를 붙이면 보내는 트랙이 바뀐다.
    await this.syncMeter();
  }

  /** 직접 재고 있다 (아니면 LiveKit의 음성 감지를 쓴다) */
  private get measuring(): boolean {
    return !!this.meter?.track && this.audioContext?.state === 'running';
  }

  /**
   * 음량 측정기를 지금 보내는 마이크 트랙에 맞춘다. 마이크가 꺼져 있으면 떼고 말하는 중을 끈다.
   * 마이크를 켜고 끌 때, 장치나 증폭을 바꿀 때 부른다.
   */
  private async syncMeter(): Promise<void> {
    const publication = this.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = publication && !publication.isMuted ? publication.track : undefined;
    const target = track instanceof LocalAudioTrack ? track.mediaStreamTrack : null;
    if (!target || this.leaving) {
      this.meter?.detach();
      this.stopSpeaking();
      return;
    }
    if (!this.meter) {
      if (this.meterState !== 'none') return;
      this.meterState = 'loading';
      try {
        this.audioContext ??= new AudioContext();
        if (this.audioContext.state === 'suspended') await this.audioContext.resume();
        this.meter = await MicLevelMeter.create(this.audioContext, (level, time) => {
          const changed = this.speech.push(level, time);
          if (changed !== null) this.handlers.onSpeaking(changed);
        });
        this.meterState = 'none';
      } catch {
        this.meterState = 'failed';
        return;
      }
      // 만드는 사이 마이크가 바뀌었거나 통화가 끝났을 수 있으니 처음부터 다시 맞춘다.
      return this.syncMeter();
    }
    if (this.meter.track === target) return;
    this.meter.attach(target);
    this.stopSpeaking();
  }

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

  private async applyGain() {
    const track = this.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    if (!(track instanceof LocalAudioTrack)) return;
    if (!this.micGain) {
      if (this.inputGain === 1) return;
      this.micGain = new MicGainProcessor(this.inputGain);
    }
    this.micGain.setGain(this.inputGain);
    if (track.getProcessor() === this.micGain) return;
    this.audioContext ??= new AudioContext();
    track.setAudioContext(this.audioContext);
    await track.setProcessor(this.micGain).catch(() => {});
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
    if (kind === 'audioinput') await this.syncMeter();
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
    this.meter?.dispose();
    this.meter = null;
    void this.audioContext?.close().catch(() => {});
    this.audioContext = null;
  }
}
