import { useEffect, useState } from 'react';
import { INPUT_GAIN_MAX, useVoiceStore } from './store';
import { useVoice } from './VoiceProvider';

type DeviceKind = 'audioinput' | 'audiooutput';

/** 마이크와 스피커 목록. 장치를 꽂거나 빼면 다시 읽는다 */
export function useAudioDevices(): Record<DeviceKind, MediaDeviceInfo[]> | null {
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => !cancelled && setDevices(list))
        .catch(() => !cancelled && setDevices([]));
    void load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, []);

  if (!devices) return null;
  return {
    audioinput: devices.filter((d) => d.kind === 'audioinput'),
    audiooutput: devices.filter((d) => d.kind === 'audiooutput'),
  };
}

const LABEL = { audioinput: '입력 장치 (마이크)', audiooutput: '출력 장치 (스피커)' } as const;
const EMPTY = {
  audioinput: '마이크를 찾지 못했습니다',
  audiooutput: '이 환경에서는 스피커를 고를 수 없습니다',
} as const;

/** 장치 고르기. 고른 장치는 기억해서 다음 통화에도 쓰고, 통화 중이면 바로 바꾼다 */
export function DeviceSelect({ kind }: { kind: DeviceKind }) {
  const voice = useVoice();
  const devices = useAudioDevices();
  const selected = useVoiceStore((s) =>
    kind === 'audioinput' ? s.inputDeviceId : s.outputDeviceId,
  );
  const list = devices?.[kind] ?? [];
  // 권한을 받기 전에는 장치 이름이 비어 있다.
  const name = (d: MediaDeviceInfo, i: number) =>
    d.label || (kind === 'audioinput' ? `마이크 ${i + 1}` : `스피커 ${i + 1}`);

  return (
    <label className="voice-field">
      <span className="voice-field__label">{LABEL[kind]}</span>
      <select
        value={selected ?? 'default'}
        onChange={(e) => void voice.switchDevice(kind, e.target.value)}
        disabled={list.length === 0}
      >
        {devices && list.length === 0 && <option>{EMPTY[kind]}</option>}
        {list.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {name(d, i)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 마이크 증폭 (0~200%) */
export function InputGainSlider() {
  const voice = useVoice();
  const value = useVoiceStore((s) => s.inputGain);
  return (
    <LevelSlider
      label="마이크 증폭"
      value={value}
      max={INPUT_GAIN_MAX}
      onChange={(v) => void voice.setInputGain(v)}
    />
  );
}

/** 들리는 소리 전체의 크기 (0~100%) */
export function OutputVolumeSlider() {
  const voice = useVoice();
  const value = useVoiceStore((s) => s.outputVolume);
  return (
    <LevelSlider
      label="출력 음량"
      value={value}
      max={1}
      onChange={(v) => voice.setOutputVolume(v)}
    />
  );
}

function LevelSlider({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange(value: number): void;
}) {
  const percent = Math.round(value * 100);
  return (
    <label className="voice-field">
      <span className="voice-field__label">
        {label}
        <output>{percent}%</output>
      </span>
      <input
        type="range"
        min={0}
        max={max * 100}
        step={5}
        value={percent}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
    </label>
  );
}
