/* global AudioWorkletProcessor, registerProcessor, currentTime, sampleRate */

// 마이크 음량 측정기 (AudioWorklet). 20ms마다 그 구간의 음량(RMS, dBFS)과 시각을 알린다.
// 오디오 스레드에서 돌기 때문에 창이 가려져 타이머가 늦어져도 같은 간격으로 잰다.
// 번들러를 거치지 않고 그대로 불러오는 파일이라 import를 쓰지 않는다 (micLevel.ts가 주소로 불러온다).

const FRAME_SECONDS = 0.02;
const SILENCE_DB = -100;

class LevelMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = Math.round(sampleRate * FRAME_SECONDS);
    this.sum = 0;
    this.count = 0;
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples) {
      for (let i = 0; i < samples.length; i++) this.sum += samples[i] * samples[i];
      this.count += samples.length;
    } else {
      // 입력이 끊겼다 (트랙이 멈춤): 조용한 것으로 센다.
      this.count += 128;
    }
    if (this.count >= this.frame) {
      const rms = Math.sqrt(this.sum / this.count);
      const level = rms > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(rms)) : SILENCE_DB;
      this.port.postMessage({ level, time: currentTime * 1000 });
      this.sum = 0;
      this.count = 0;
    }
    return true;
  }
}

registerProcessor('metacode-level-meter', LevelMeter);
