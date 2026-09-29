import { useEffect, useRef, useState } from 'react';
import {
  LEVEL_MAX_DB,
  LEVEL_MIN_DB,
  THRESHOLD_MAX_DB,
  THRESHOLD_MIN_DB,
  clamp,
  levelRatio,
} from './gate';
import { MicPreview, micReports } from './micChain';
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
      onChange={(v) => voice.setInputGain(v)}
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

/** RNNoise 잡음 제거 켜기/끄기 */
export function NoiseSuppressionToggle() {
  const voice = useVoice();
  const on = useVoiceStore((s) => s.noiseSuppression);
  return (
    <div className="voice-field">
      <label className="voice-check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => void voice.setNoiseSuppression(e.target.checked)}
        />
        잡음 제거
      </label>
      <span className="form__hint">
        키보드·선풍기 같은 주변 소리를 걸러 목소리만 보냅니다 (RNNoise). 끄면 브라우저 기본 잡음
        억제만 씁니다.
      </span>
    </div>
  );
}

/**
 * 입력 감도: 자동(잡음 크기를 보고 문턱을 정함) 또는 직접 정하기 + 실시간 막대.
 * 막대는 잡음 제거를 거친 마이크 음량이고, 문턱(세로 선)을 넘어 초록색일 때만 소리가 나간다.
 * 통화 중에는 보내는 마이크를, 아니면(preview) 같은 처리로 마이크를 잠깐 열어 보여 준다 (보내지 않음).
 */
export function InputSensitivity({ preview = false }: { preview?: boolean }) {
  const voice = useVoice();
  const sensitivity = useVoiceStore((s) => s.sensitivity);
  const noiseSuppression = useVoiceStore((s) => s.noiseSuppression);
  const inputDeviceId = useVoiceStore((s) => s.inputDeviceId);
  const inputGain = useVoiceStore((s) => s.inputGain);
  // 통화 중이고 마이크가 켜져 있으면 보내는 마이크의 음량을 쓴다.
  const live = useVoiceStore(
    (s) => !!s.session && !s.session.listenOnly && !s.muted && !s.deafened,
  );
  const [previewError, setPreviewError] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLOutputElement>(null);
  const previewRef = useRef<MicPreview | null>(null);
  const manual = sensitivity.mode === 'manual';

  // 음량은 초당 50번 오므로 다시 그리지 않고 막대만 직접 옮긴다.
  useEffect(
    () =>
      micReports.subscribe(({ level, threshold }) => {
        const bar = barRef.current;
        if (bar) {
          bar.style.width = `${levelRatio(level) * 100}%`;
          bar.dataset.open = String(level >= threshold);
        }
        if (markerRef.current) markerRef.current.style.left = `${levelRatio(threshold) * 100}%`;
        // 자동일 때만 알려 준 문턱을 적는다 (직접 정하면 정한 값을 그린다).
        if (valueRef.current) valueRef.current.textContent = `자동 문턱 ${Math.round(threshold)}dB`;
      }),
    [],
  );

  // 마이크 시험: 설정 창에서 통화 중이 아닐 때만 연다.
  useEffect(() => {
    if (!preview || live) return;
    const bar = barRef.current;
    let cancelled = false;
    const { sensitivity: current, inputGain: gain } = useVoiceStore.getState();
    MicPreview.start({ noiseSuppression, gain, sensitivity: current }, inputDeviceId).then(
      (started) => {
        if (cancelled) return started.stop();
        previewRef.current = started;
        setPreviewError(false);
      },
      () => !cancelled && setPreviewError(true),
    );
    return () => {
      cancelled = true;
      previewRef.current?.stop();
      previewRef.current = null;
      if (bar) bar.style.width = '0%';
    };
  }, [preview, live, noiseSuppression, inputDeviceId]);

  useEffect(() => {
    previewRef.current?.setSensitivity(sensitivity);
    previewRef.current?.setGain(inputGain);
  }, [sensitivity, inputGain]);

  const setMode = (mode: 'auto' | 'manual') => voice.setSensitivity({ ...sensitivity, mode });

  return (
    <div className="voice-field">
      <span className="voice-field__label">
        입력 감도
        {manual ? (
          <output key="manual">문턱 {sensitivity.thresholdDb}dB</output>
        ) : (
          <output key="auto" ref={valueRef} />
        )}
      </span>
      <div className="sensitivity__modes" role="radiogroup" aria-label="입력 감도 정하는 방법">
        {(['auto', 'manual'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={sensitivity.mode === mode}
            onClick={() => setMode(mode)}
          >
            {mode === 'auto' ? '자동' : '직접 정하기'}
          </button>
        ))}
      </div>
      <div className="sensitivity-meter" data-manual={manual}>
        <div className="sensitivity-meter__level" ref={barRef} data-open="false" />
        <div
          className="sensitivity-meter__threshold"
          ref={markerRef}
          style={manual ? { left: `${levelRatio(sensitivity.thresholdDb) * 100}%` } : undefined}
        />
        {manual && (
          <input
            type="range"
            className="sensitivity-meter__slider"
            min={LEVEL_MIN_DB}
            max={LEVEL_MAX_DB}
            step={1}
            value={sensitivity.thresholdDb}
            aria-label="소리 문턱 (dB)"
            onChange={(e) =>
              voice.setSensitivity({
                mode: 'manual',
                thresholdDb: clamp(Number(e.target.value), THRESHOLD_MIN_DB, THRESHOLD_MAX_DB),
              })
            }
          />
        )}
      </div>
      <span className="form__hint">
        {manual
          ? '막대가 초록색일 때만 소리가 나갑니다. 세로 선을 끌어 문턱을 정하세요 (오른쪽일수록 큰 소리만).'
          : '말하지 않을 때의 잡음 크기를 보고 문턱을 알아서 정합니다. 막대가 초록색일 때만 소리가 나갑니다.'}
        {preview && !live && previewError && ' 마이크를 열지 못해 막대를 보여 줄 수 없습니다.'}
        {!preview && !live && ' 통화 중에 마이크를 켜면 막대가 움직입니다.'}
      </span>
    </div>
  );
}
