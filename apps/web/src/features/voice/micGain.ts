import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';

/**
 * 마이크 증폭: 올리기 전에 마이크 소리를 WebAudio GainNode로 키우거나 줄인다 (LiveKit 오디오 처리기).
 * 장치를 바꾸면 LiveKit이 restart로 새 트랙을 넘긴다. 값은 실행 중에 바로 바꿀 수 있다.
 */
export class MicGainProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'metacode-mic-gain';
  processedTrack?: MediaStreamTrack;
  private nodes: { source: MediaStreamAudioSourceNode; gain: GainNode } | null = null;

  constructor(private value: number) {}

  async init({ track, audioContext }: AudioProcessorOptions): Promise<void> {
    if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {});
    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    const gain = audioContext.createGain();
    gain.gain.value = this.value;
    const destination = audioContext.createMediaStreamDestination();
    source.connect(gain).connect(destination);
    this.nodes = { source, gain };
    this.processedTrack = destination.stream.getAudioTracks()[0];
  }

  async restart(options: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(options);
  }

  async destroy(): Promise<void> {
    this.nodes?.source.disconnect();
    this.nodes?.gain.disconnect();
    this.processedTrack?.stop();
    this.nodes = null;
    this.processedTrack = undefined;
  }

  setGain(value: number): void {
    this.value = value;
    if (this.nodes) this.nodes.gain.gain.value = value;
  }
}
