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

export interface ConnectionHandlers {
  /** 내가 말하기 시작하거나 멈췄다 (LiveKit의 음성 감지) */
  onSpeaking(speaking: boolean): void;
  onReconnecting(): void;
  onReconnected(): void;
  /** 내가 끊지 않았는데 끊겼다. 같은 사람이 다른 곳에서 들어오면 duplicate */
  onDropped(reason: 'duplicate' | 'other'): void;
  /** 브라우저가 소리 재생을 막았다 (사용자가 한 번 눌러야 한다) */
  onPlaybackBlocked(blocked: boolean): void;
}

export interface ConnectOptions {
  micEnabled: boolean;
  inputDeviceId: string | null;
  outputDeviceId: string | null;
}

/**
 * 통화 하나의 LiveKit 연결. 자동 구독은 끄고, 누구를 얼마나 크게 들을지는 applyVolumes로 정한다
 * (근접 음성: 들리지 않는 사람은 구독하지 않아 대역폭도 아낀다).
 * 받은 음성은 화면에 보이지 않는 <audio>로 튼다.
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
  /** 음량을 정하기 전에는 아무도 구독하지 않는다 (근접 음성에서 먼 사람이 잠깐 들리지 않게) */
  private volumeOf: (identity: string) => number = () => 0;
  private leaving = false;

  constructor(private readonly handlers: ConnectionHandlers) {
    this.audioHost.hidden = true;
    document.body.append(this.audioHost);

    this.room
      .on(RoomEvent.TrackPublished, (publication, participant) =>
        this.applyTo(participant, publication),
      )
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio || !track.sid) return;
        const element = track.attach();
        this.elements.set(track.sid, element);
        this.audioHost.append(element);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach();
        if (!track.sid) return;
        this.elements.get(track.sid)?.remove();
        this.elements.delete(track.sid);
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
    this.localParticipant.on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) =>
      handlers.onSpeaking(speaking),
    );
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
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        this.applyTo(participant, publication);
      }
    }
    this.handlers.onPlaybackBlocked(!this.room.canPlaybackAudio);
    return this.setMicEnabled(options.micEnabled, options.inputDeviceId);
  }

  /** 마이크 켜기/끄기. 켜려는데 장치가 없거나 권한이 없으면 false */
  async setMicEnabled(enabled: boolean, deviceId: string | null): Promise<boolean> {
    try {
      await this.localParticipant.setMicrophoneEnabled(
        enabled,
        deviceId ? { deviceId: { ideal: deviceId } } : undefined,
      );
      return true;
    } catch {
      return !enabled;
    }
  }

  /** 참여자별 음량을 정한다. 0이면 구독을 끊는다 */
  applyVolumes(volumeOf: (identity: string) => number): void {
    this.volumeOf = volumeOf;
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        this.applyTo(participant, publication);
      }
    }
  }

  private applyTo(participant: RemoteParticipant, publication: RemoteTrackPublication) {
    if (publication.kind !== Track.Kind.Audio) return;
    const volume = this.volumeOf(participant.identity);
    // isDesired: 구독을 요청해 둔 상태 (아직 연결 중이어도 true). isSubscribed로 보면 요청 중인 구독을 끊지 못한다.
    if (volume <= 0) {
      if (publication.isDesired) publication.setSubscribed(false);
      return;
    }
    if (!publication.isDesired) publication.setSubscribed(true);
    participant.setVolume(volume);
  }

  switchDevice(kind: 'audioinput' | 'audiooutput', deviceId: string): Promise<boolean> {
    return this.room.switchActiveDevice(kind, deviceId).catch(() => false);
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
    this.audioHost.remove();
  }
}
