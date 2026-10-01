import {
  AVATAR_MAX_BYTES,
  type AvatarUploadTicket,
  type ImageCrop,
  BIO_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
  type UserDetail,
} from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ApiError, apiFetch } from '../../api/client';
import { jsonBody } from '../../api/queries';
import { type SettingsSection, useSettingsStore } from '../../stores/settings';
import { Avatar } from '../../ui/Avatar';
import { displayName } from '@metacode/client';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import {
  type CropSource,
  ImageCropDialog,
  cropSource,
  releaseCropSource,
} from '../../ui/ImageCropDialog';
import { useExitTransition } from '../../ui/useExitTransition';
import { closeAssetEditors } from '../assets/AssetEditors';
import { logout, meQueryKey, useMe } from '../auth/auth';
import {
  DeviceSelect,
  InputGainSlider,
  InputSensitivity,
  NoiseSuppressionToggle,
  OutputVolumeSlider,
} from '../voice/devices';
import { AppearanceSettings } from './AppearanceSettings';
import { FeatureGuide } from './FeatureGuide';
import { useIsPhone } from '../../ui/useMediaQuery';
import {
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Keyboard,
  LogOut,
  Mic,
  Palette,
  Pencil,
  PersonStanding,
  SunMoon,
  X,
} from 'lucide-react';

const SECTIONS: {
  group: string;
  items: { id: SettingsSection; label: string; icon: ReactNode }[];
}[] = [
  {
    group: '사용자 설정',
    items: [
      { id: 'account', label: '내 계정', icon: <CircleUserRound aria-hidden /> },
      { id: 'character', label: '캐릭터', icon: <PersonStanding aria-hidden /> },
      { id: 'assets', label: '에셋', icon: <Palette aria-hidden /> },
    ],
  },
  {
    group: '앱 설정',
    items: [
      { id: 'appearance', label: '화면', icon: <SunMoon aria-hidden /> },
      { id: 'voice', label: '음성', icon: <Mic aria-hidden /> },
    ],
  },
  {
    group: '도움말',
    items: [{ id: 'features', label: '기능', icon: <Keyboard aria-hidden /> }],
  },
];
const TITLE: Record<SettingsSection, string> = {
  account: '내 계정',
  character: '캐릭터',
  assets: '에셋',
  appearance: '화면',
  voice: '음성',
  features: '기능',
};

/** 여닫는 애니메이션 길이 (styles.css의 settings-in/out과 같게) */
const TRANSITION_MS = 160;

// 캐릭터, 에셋 목록은 내장 에셋(약 150KB)을 쓰므로 열 때 따로 불러온다.
const CharacterSettings = lazy(() =>
  import('../assets/CharacterSettings').then((m) => ({ default: m.CharacterSettings })),
);
const AssetSettings = lazy(() =>
  import('../assets/AssetSettings').then((m) => ({ default: m.AssetSettings })),
);

/**
 * 설정 창: 화면의 80%를 차지하고, 바깥(어두운 곳)을 누르거나 Esc를 누르면 닫힌다.
 * 왼쪽 목록에서 항목을 고른다 (내 계정: 프로필, 화면: 라이트/다크, 음성: 장치와 음량). 로그아웃도 여기에 있다.
 */
export function SettingsDialog() {
  const section = useSettingsStore((s) => s.section);
  // 닫을 때는 잠깐 그대로 두고 사라지는 애니메이션을 보여 준다.
  const { shown, closing } = useExitTransition(section, TRANSITION_MS);
  if (!shown) return null;
  return <SettingsWindow section={shown} closing={closing} />;
}

function SettingsWindow({ section, closing }: { section: SettingsSection; closing: boolean }) {
  const { open, close } = useSettingsStore.getState();
  const me = useMe().data;
  const queryClient = useQueryClient();
  const [confirmLogout, setConfirmLogout] = useState(false);
  // 휴대폰은 목록과 내용을 한 화면씩 보여 준다 (넓은 화면은 둘 다 보이므로 쓰지 않음).
  const phone = useIsPhone();
  const [page, setPage] = useState<'list' | 'content'>(() =>
    useSettingsStore.getState().listFirst ? 'list' : 'content',
  );
  const show = (id: SettingsSection) => {
    open(id);
    setPage('content');
  };

  useEffect(() => {
    // 설정 창 위에 뜬 창(도트 에디터 등)이 Esc를 먼저 처리하면(preventDefault) 닫지 않는다.
    // 휴대폰에서 내용을 보고 있으면 목록으로 돌아간다 (안드로이드 뒤로 가기도 Esc로 온다).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (phone && page === 'content') setPage('list');
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, phone, page]);

  // 설정 창을 닫으면 열려 있던 도트 에디터와 맵 에디터도 닫는다.
  useEffect(() => closeAssetEditors, []);

  const onLogout = async () => {
    setConfirmLogout(false);
    close();
    await logout();
    // 먼저 로그아웃 상태로 바꿔 로그인 화면으로 돌아간 뒤, 이전 사용자의 데이터를 지운다.
    // clear()를 쓰면 App이 구독 중인 'me' 쿼리까지 사라져 화면이 바뀌지 않는다.
    queryClient.setQueryData(meQueryKey, null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
  };

  if (!me) return null;
  return (
    <div
      className="settings-overlay"
      data-closing={closing || undefined}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className="settings-window"
        role="dialog"
        aria-modal="true"
        aria-label="설정"
        data-page={page}
      >
        <nav className="settings-nav" aria-label="설정 항목">
          {/* 휴대폰 목록 화면의 머리글 (넓은 화면에서는 CSS로 숨김) */}
          <div className="settings-nav__header">
            <h2>설정</h2>
            <button className="icon-button" onClick={close} aria-label="설정 닫기">
              <X aria-hidden />
            </button>
          </div>
          <div className="settings-nav__me">
            <Avatar user={me} size={44} animate />
            <div>
              <strong>{displayName(me)}</strong>
              <span className="settings-nav__username">@{me.username}</span>
              <button type="button" onClick={() => show('account')}>
                <Pencil aria-hidden />
                프로필 편집
              </button>
            </div>
          </div>
          {SECTIONS.map(({ group, items }) => (
            <div key={group} className="settings-nav__group">
              <p>{group}</p>
              <div className="settings-nav__items">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={section === item.id ? 'page' : undefined}
                    onClick={() => show(item.id)}
                  >
                    {item.icon}
                    {item.label}
                    <ChevronRight className="settings-nav__chevron" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            className="settings-nav__logout"
            onClick={() => setConfirmLogout(true)}
          >
            <LogOut aria-hidden />
            로그아웃
          </button>
        </nav>
        <section className="settings-content">
          <header className="settings-content__header">
            {/* 휴대폰: 목록으로 돌아가기 (넓은 화면에서는 CSS로 숨김) */}
            <button
              className="icon-button settings-content__back"
              onClick={() => setPage('list')}
              aria-label="설정 목록으로"
            >
              <ChevronLeft aria-hidden />
            </button>
            <h2>{TITLE[section]}</h2>
            <button
              className="icon-button"
              onClick={close}
              aria-label="설정 닫기"
              title="닫기 (Esc)"
            >
              <X aria-hidden />
            </button>
          </header>
          <div className="settings-content__body">
            {section === 'account' && <AccountSettings me={me} />}
            {section === 'character' && (
              <Suspense fallback={<p className="form__hint">불러오는 중…</p>}>
                <CharacterSettings me={me} />
              </Suspense>
            )}
            {section === 'assets' && (
              <Suspense fallback={<p className="form__hint">불러오는 중…</p>}>
                <AssetSettings />
              </Suspense>
            )}
            {section === 'appearance' && <AppearanceSettings />}
            {section === 'voice' && <VoiceSettings />}
            {section === 'features' && <FeatureGuide />}
          </div>
        </section>
      </div>
      {confirmLogout && (
        <ConfirmDialog
          title="로그아웃할까요?"
          confirmLabel="로그아웃"
          danger
          onConfirm={() => void onLogout()}
          onCancel={() => setConfirmLogout(false)}
        >
          다시 쓰려면 GitHub로 다시 로그인해야 합니다.
        </ConfirmDialog>
      )}
    </div>
  );
}

// ── 내 계정 ──

function AccountSettings({ me }: { me: UserDetail }) {
  const queryClient = useQueryClient();
  const [nickname, setNickname] = useState(me.displayName ?? '');
  const [bio, setBio] = useState(me.bio ?? '');
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // 고른 사진: 올리기 전에 보일 곳을 고른다.
  const [cropping, setCropping] = useState<CropSource | null>(null);
  const finishCrop = () => {
    releaseCropSource(cropping);
    setCropping(null);
  };
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = nickname.trim() !== (me.displayName ?? '') || bio.trim() !== (me.bio ?? '');

  const apply = (detail: UserDetail) => queryClient.setQueryData(meQueryKey, detail);
  const run = async (action: () => Promise<UserDetail>, ok: string, fallback: string) => {
    setBusy(true);
    setStatus(null);
    try {
      apply(await action());
      setStatus({ kind: 'ok', text: ok });
      return true;
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof ApiError || err instanceof Error ? err.message : fallback,
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () =>
        apiFetch<UserDetail>('/users/me', {
          method: 'PATCH',
          ...jsonBody({ nickname: nickname.trim(), bio: bio.trim() }),
        }),
      '저장했습니다.',
      '저장하지 못했습니다.',
    );
    if (ok) {
      setNickname((v) => v.trim());
      setBio((v) => v.trim());
    }
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > AVATAR_MAX_BYTES) {
      setStatus({ kind: 'error', text: '15MB 이하의 사진만 올릴 수 있습니다.' });
      return;
    }
    setStatus(null);
    setCropping(cropSource(file));
  };

  const applyCrop = (file: File, crop: ImageCrop | undefined) => {
    finishCrop();
    void run(
      () => uploadAvatar(file, crop),
      '프로필 사진을 바꿨습니다.',
      '사진을 올리지 못했습니다.',
    );
  };

  return (
    <form className="settings-form" onSubmit={save}>
      <div className="settings-profile">
        <Avatar user={me} size={88} animate />
        <div className="settings-profile__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            사진 바꾸기
          </button>
          {me.customAvatar && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => apiFetch<UserDetail>('/users/me/avatar', { method: 'DELETE' }),
                  'GitHub 사진으로 되돌렸습니다.',
                  '사진을 되돌리지 못했습니다.',
                )
              }
            >
              GitHub 사진으로 되돌리기
            </button>
          )}
          <p className="form__hint">
            JPEG, PNG, GIF, WebP · 15MB 이하. 올릴 때 보일 곳을 고를 수 있습니다.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            hidden
            onChange={onPick}
          />
        </div>
      </div>

      {cropping && (
        <ImageCropDialog
          source={cropping}
          title="프로필 사진 위치 조정"
          aspect={1}
          shape="circle"
          onCancel={finishCrop}
          onApply={(crop) => applyCrop(cropping.file, crop)}
        />
      )}

      <div className="settings-field">
        <span className="settings-field__label">사용자 ID</span>
        <div className="settings-id">
          <code>@{me.username}</code>
          <button
            type="button"
            className="button"
            onClick={() => void navigator.clipboard.writeText(me.username).catch(() => {})}
          >
            복사
          </button>
        </div>
        <p className="form__hint">
          GitHub 아이디로 정해지며 바꿀 수 없습니다. 다른 사람이 나를 찾을 때 이 ID를 씁니다.
        </p>
      </div>

      <label className="settings-field">
        <span className="settings-field__label">닉네임</span>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={me.username}
          maxLength={NICKNAME_MAX_LENGTH}
        />
        <span className="form__hint">
          다른 사람에게 보이는 이름입니다. 비워 두면 사용자 ID를 보여 줍니다.
        </span>
      </label>

      <label className="settings-field">
        <span className="settings-field__label">
          자기소개
          <output>
            {bio.length}/{BIO_MAX_LENGTH}
          </output>
        </span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={BIO_MAX_LENGTH}
          rows={4}
          placeholder="나를 소개해 보세요"
        />
      </label>

      <div className="settings-form__footer">
        {status && (
          <p className={status.kind === 'ok' ? 'form__ok' : 'form__error'} role="status">
            {status.text}
          </p>
        )}
        <button
          type="button"
          className="button"
          disabled={!dirty || busy}
          onClick={() => {
            setNickname(me.displayName ?? '');
            setBio(me.bio ?? '');
            setStatus(null);
          }}
        >
          되돌리기
        </button>
        <button className="button button--primary" disabled={!dirty || busy}>
          저장
        </button>
      </div>
    </form>
  );
}

/** 프로필 사진 올리기: 저장소에 바로 올리고, 서버가 확인해 고른 곳(crop)을 잘라 적용한다 */
async function uploadAvatar(file: File, crop: ImageCrop | undefined): Promise<UserDetail> {
  const ticket = await apiFetch<AvatarUploadTicket>('/users/me/avatar/upload', {
    method: 'POST',
    ...jsonBody({ size: file.size }),
  });
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: file });
  if (!put.ok) throw new Error('사진을 올리지 못했습니다.');
  return apiFetch<UserDetail>('/users/me/avatar', { method: 'PUT', ...jsonBody({ crop }) });
}

// ── 음성 ──

function VoiceSettings() {
  return (
    <div className="settings-form">
      <h3 className="settings-form__title">입력</h3>
      <DeviceSelect kind="audioinput" />
      <NoiseSuppressionToggle />
      <InputSensitivity preview />
      <InputGainSlider />
      <h3 className="settings-form__title">출력</h3>
      <DeviceSelect kind="audiooutput" />
      <OutputVolumeSlider />
      <p className="form__hint">
        통화 중이면 바로 바뀌고, 다음 통화에도 이 설정을 씁니다. 마이크·헤드셋 버튼을 우클릭하거나
        옆의 위쪽 화살표를 눌러도 바꿀 수 있습니다.
      </p>
    </div>
  );
}
