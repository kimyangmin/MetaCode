import type { TrackKind } from '@metacode/client';
import { AndroidAudioTypePresets, AudioSession, registerGlobals } from '@livekit/react-native';
import {
  DisconnectReason,
  type LocalParticipant,
  ParticipantEvent,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';

// LiveKit이 쓰는 WebRTC 전역(RTCPeerConnection, MediaStream 등)을 네이티브 모듈로 채운다.
// 이 파일은 처음 통화에 들어갈 때 불러오므로, 네이티브 모듈이 없는 예전 개발 빌드도 통화 전까지는 그대로 뜬다.
registerGlobals();

export interface ConnectionHandlers {
  /** 내가 말하기 시작하거나 멈췄다 (LiveKit의 음성 감지) */
  onSpeaking(speaking: boolean): void;
  onReconnecting(): void;
  onReconnected(): void;
  /** 내가 끊지 않았는데 끊겼다. 같은 사람이 다른 곳에서 들어오면 duplicate */
  onDropped(reason: 'duplicate' | 'other'): void;
  /** 보고 있는 사람의 화면 공유 영상을 받기 시작했거나(주소) 끊겼다(null) */
  onScreen(identity: string, streamUrl: string | null): void;
}

/** 트랙 종류별 구독 여부와 음량. 0이면 구독하지 않는다 */
export type VolumePolicy = (identity: string, kind: TrackKind) => number;

const kindOf = (source: Track.Source): TrackKind | null => {
  if (source === Track.Source.Microphone) return 'microphone';
  if (source === Track.Source.ScreenShare) return 'screen';
  if (source === Track.Source.ScreenShareAudio) return 'screen-audio';
  return null;
};

/** 말하는 중이 멈춘 뒤 이만큼 기다렸다 끈다 (단어 사이에 깜빡이지 않게, 웹 SPEECH_RELEASE_MS) */
const SPEECH_RELEASE_MS = 300;

/**
 * 통화 하나의 LiveKit 연결 (웹 connection.ts의 휴대폰판). 자동 구독은 끄고 applyVolumes로 무엇을 얼마나 크게
 * 받을지 정한다 (근접 음성, 보고 있는 화면 공유만). 받은 소리는 WebRTC가 통화 오디오로 바로 튼다.
 *
 * 웹과 달리 마이크 처리기(RNNoise, 소리 문턱)가 없다: 안드로이드의 통화 오디오(잡음 억제·에코 제거)를 쓰고,
 * 말하는 중은 LiveKit 서버의 음성 감지(조금 늦음)로 판단한다.
 */
export class VoiceConnection {
  private readonly room = new Room({ adaptiveStream: false, dynacast: false });
  private readonly screens = new Map<string, string>();
  private policy: VolumePolicy = () => 0;
  private leaving = false;
  private speechTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly handlers: ConnectionHandlers) {
    this.room
      .on(RoomEvent.TrackPublished, (publication, participant) =>
        this.applyTo(participant, publication),
      )
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant) => {
        if (track.kind !== Track.Kind.Video) return;
        const stream = new MediaStream([track.mediaStreamTrack]);
        // react-native-webrtc의 MediaStream은 RTCView에 넘길 주소를 준다
        const url = (stream as MediaStream & { toURL(): string }).toURL();
        this.screens.set(participant.identity, url);
        handlers.onScreen(participant.identity, url);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _publication, participant) => {
        if (track.kind !== Track.Kind.Video) return;
        this.screens.delete(participant.identity);
        handlers.onScreen(participant.identity, null);
      })
      .on(RoomEvent.Reconnecting, () => handlers.onReconnecting())
      .on(RoomEvent.Reconnected, () => handlers.onReconnected())
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        this.cleanup();
        if (!this.leaving) {
          handlers.onDropped(
            reason === DisconnectReason.DUPLICATE_IDENTITY ? 'duplicate' : 'other',
          );
        }
      });
    this.localParticipant.on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) => {
      clearTimeout(this.speechTimer);
      if (speaking) handlers.onSpeaking(true);
      else this.speechTimer = setTimeout(() => handlers.onSpeaking(false), SPEECH_RELEASE_MS);
    });
  }

  private get localParticipant(): LocalParticipant {
    return this.room.localParticipant;
  }

  /** 들어간다. 마이크를 쓸 수 없으면(권한 거절) 듣기만 하고 false를 돌려준다 */
  async connect(url: string, token: string, micEnabled: boolean): Promise<boolean> {
    // 통화용 오디오: 스피커로 내보내되 이어폰·블루투스가 있으면 그쪽으로
    await AudioSession.configureAudio({
      android: {
        preferredOutputList: ['bluetooth', 'headset', 'speaker'],
        audioTypeOptions: AndroidAudioTypePresets.communication,
      },
    });
    await AudioSession.startAudioSession();
    await this.room.connect(url, token, { autoSubscribe: false });
    this.applyAll();
    return this.setMicEnabled(micEnabled);
  }

  /** 마이크 켜기/끄기. 켜려는데 권한이 없으면 false */
  async setMicEnabled(enabled: boolean): Promise<boolean> {
    clearTimeout(this.speechTimer);
    this.handlers.onSpeaking(false);
    try {
      await this.localParticipant.setMicrophoneEnabled(enabled, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      return true;
    } catch {
      return !enabled;
    }
  }

  /** 지금 받고 있는 이 사람의 화면 공유 영상 주소 (받고 있지 않으면 null) */
  screenOf(identity: string): string | null {
    return this.screens.get(identity) ?? null;
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

  async disconnect(): Promise<void> {
    this.leaving = true;
    await this.room.disconnect();
    this.cleanup();
  }

  private cleanup() {
    clearTimeout(this.speechTimer);
    this.screens.clear();
    void AudioSession.stopAudioSession().catch(() => {});
  }
}
