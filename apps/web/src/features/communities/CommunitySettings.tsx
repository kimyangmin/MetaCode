import {
  AVATAR_MAX_BYTES,
  type AvatarUploadTicket,
  COMMUNITY_IMAGE_SIZE,
  type CommunityImageKind,
  type CommunityMember,
  CommunityRole,
  type CommunitySummary,
  type ImageCrop,
  type RoleDto,
} from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import { ApiError, apiFetch } from '../../api/client';
import { jsonBody, queryKeys } from '../../api/queries';
import { Avatar } from '../../ui/Avatar';
import { Dialog } from '../../ui/Dialog';
import {
  type CropSource,
  ImageCropDialog,
  cropSource,
  releaseCropSource,
} from '../../ui/ImageCropDialog';
import { displayName, initials } from '../../ui/format';
import { useDragSort } from '../../ui/useDragSort';
import { closeAssetEditors } from '../assets/AssetEditors';
import { useMeRequired, useMembers } from './hooks';
import { GripVertical, X } from 'lucide-react';

const DEFAULT_COLOR = '#3f8fdb';

// 광장 에셋 목록은 내장 에셋(약 150KB)을 쓰므로 열 때 따로 불러온다.
const CommunityPlazaAssets = lazy(() =>
  import('../assets/AssetSettings').then((m) => ({ default: m.CommunityPlazaAssets })),
);

type Tab = 'general' | 'plaza' | 'roles' | 'members';

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: '일반' },
  { id: 'plaza', label: '광장' },
  { id: 'roles', label: '역할' },
  { id: 'members', label: '멤버' },
];

/**
 * 커뮤니티 설정 (소유자, 관리자).
 * - 일반: 이름, 아이콘, 배너, 커뮤니티 삭제(소유자만)
 * - 광장: 커뮤니티 타일·오브젝트, 광장 맵 편집
 * - 역할: 역할 만들기/바꾸기/지우기 / 멤버: 역할 주기, 관리자 정하기(소유자만), 내보내기
 * 비공개 채널을 누가 볼지는 채널 설정에서 역할로 정한다.
 */
export function CommunitySettings({
  community,
  onClose,
}: {
  community: CommunitySummary;
  onClose(): void;
}) {
  const [tab, setTab] = useState<Tab>('general');
  // 여기서 연 도트 에디터·맵 에디터는 설정을 닫으면 함께 닫는다.
  useEffect(() => closeAssetEditors, []);
  return (
    <Dialog title="커뮤니티 설정" onClose={onClose} className="dialog--wide dialog--settings">
      <div className="settings">
        <div className="settings__tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'general' && <GeneralTab community={community} />}
        {tab === 'plaza' && (
          <Suspense fallback={<p className="form__hint">불러오는 중…</p>}>
            <CommunityPlazaAssets community={community} />
          </Suspense>
        )}
        {tab === 'roles' && <RolesTab community={community} />}
        {tab === 'members' && <MembersTab community={community} />}
      </div>
    </Dialog>
  );
}

const IMAGE_LABEL: Record<CommunityImageKind, string> = { icon: '아이콘', banner: '배너' };
/** 목적격 조사까지 붙인 이름 (아이콘을, 배너를) */
const IMAGE_OBJECT: Record<CommunityImageKind, string> = { icon: '아이콘을', banner: '배너를' };

/** 아이콘·배너 올리기: 저장소에 바로 올리고, 서버가 확인해 고른 곳(crop)을 잘라 적용한다 */
async function uploadImage(
  communityId: string,
  kind: CommunityImageKind,
  file: File,
  crop: ImageCrop | undefined,
) {
  const base = `/communities/${communityId}/images/${kind}`;
  const ticket = await apiFetch<AvatarUploadTicket>(`${base}/upload`, {
    method: 'POST',
    ...jsonBody({ size: file.size }),
  });
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: file });
  if (!put.ok) throw new Error('이미지를 올리지 못했습니다.');
  await apiFetch(base, { method: 'PUT', ...jsonBody({ crop }) });
}

function GeneralTab({ community }: { community: CommunitySummary }) {
  const refresh = useRefresh(community.id);
  const { error, run } = useRequest();
  const [name, setName] = useState(community.name);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // 고른 이미지: 올리기 전에 보일 곳을 고른다.
  const [cropping, setCropping] = useState<{ kind: CommunityImageKind; source: CropSource } | null>(
    null,
  );
  const finishCrop = () => {
    releaseCropSource(cropping?.source ?? null);
    setCropping(null);
  };
  const isOwner = community.myRole === CommunityRole.Owner;

  const act = async (request: () => Promise<unknown>, fallback: string, ok: string) => {
    setBusy(true);
    setSaved(null);
    const done = await run(request, fallback);
    setBusy(false);
    if (done) {
      setSaved(ok);
      refresh();
    }
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    void act(
      () =>
        apiFetch(`/communities/${community.id}`, {
          method: 'PATCH',
          ...jsonBody({ name: name.trim() }),
        }),
      '이름을 바꾸지 못했습니다.',
      '이름을 바꿨습니다.',
    );
  };

  const pick = (kind: CommunityImageKind, file: File) => {
    if (file.size > AVATAR_MAX_BYTES) {
      void run(() => Promise.reject(new Error()), '8MB 이하의 이미지만 올릴 수 있습니다.');
      return;
    }
    setSaved(null);
    setCropping({ kind, source: cropSource(file) });
  };

  const upload = (kind: CommunityImageKind, file: File, crop: ImageCrop | undefined) => {
    finishCrop();
    void act(
      () => uploadImage(community.id, kind, file, crop),
      `${IMAGE_OBJECT[kind]} 올리지 못했습니다.`,
      `${IMAGE_OBJECT[kind]} 바꿨습니다.`,
    );
  };

  const remove = (kind: CommunityImageKind) =>
    void act(
      () => apiFetch(`/communities/${community.id}/images/${kind}`, { method: 'DELETE' }),
      `${IMAGE_OBJECT[kind]} 지우지 못했습니다.`,
      `${IMAGE_OBJECT[kind]} 지웠습니다.`,
    );

  const trimmed = name.trim();
  return (
    <div className="community-general">
      <form className="settings-field" onSubmit={rename}>
        <span className="settings-field__label">이름</span>
        <div className="settings__row">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
          <button
            className="button button--primary"
            disabled={busy || !trimmed || trimmed === community.name}
          >
            저장
          </button>
        </div>
      </form>

      <ImageField
        kind="icon"
        community={community}
        busy={busy}
        onPick={(file) => pick('icon', file)}
        onRemove={() => remove('icon')}
      />
      <ImageField
        kind="banner"
        community={community}
        busy={busy}
        onPick={(file) => pick('banner', file)}
        onRemove={() => remove('banner')}
      />

      {(error || saved) && (
        <p className={error ? 'form__error' : 'form__ok'} role="status">
          {error ?? saved}
        </p>
      )}

      {isOwner && <DeleteCommunity community={community} />}

      {cropping && (
        <ImageCropDialog
          source={cropping.source}
          title={`${IMAGE_LABEL[cropping.kind]} 위치 조정`}
          aspect={
            COMMUNITY_IMAGE_SIZE[cropping.kind].width / COMMUNITY_IMAGE_SIZE[cropping.kind].height
          }
          shape={cropping.kind === 'icon' ? 'rounded' : 'rect'}
          onCancel={finishCrop}
          onApply={(crop) => upload(cropping.kind, cropping.source.file, crop)}
        />
      )}
    </div>
  );
}

function ImageField({
  kind,
  community,
  busy,
  onPick,
  onRemove,
}: {
  kind: CommunityImageKind;
  community: CommunitySummary;
  busy: boolean;
  onPick(file: File): void;
  onRemove(): void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const url = kind === 'icon' ? community.iconUrl : community.bannerUrl;
  const { width, height } = COMMUNITY_IMAGE_SIZE[kind];
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onPick(file);
  };
  return (
    <div className="settings-field">
      <span className="settings-field__label">{IMAGE_LABEL[kind]}</span>
      <div className="community-image">
        <div className={`community-image__preview community-image__preview--${kind}`}>
          {url ? (
            <img src={url} alt="" />
          ) : kind === 'icon' ? (
            <span>{initials(community.name)}</span>
          ) : (
            <span className="form__hint">배너 없음</span>
          )}
        </div>
        <div className="community-image__actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {url ? '바꾸기' : '올리기'}
          </button>
          {url && (
            <button type="button" className="button" disabled={busy} onClick={onRemove}>
              지우기
            </button>
          )}
          <p className="form__hint">
            {kind === 'icon'
              ? '왼쪽 커뮤니티 목록과 초대 화면에 보입니다.'
              : '채널 목록 위에 보입니다.'}{' '}
            {width}×{height}로 씁니다. 올릴 때 보일 곳을 고릅니다 · 8MB 이하
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          hidden
          onChange={onChange}
        />
      </div>
    </div>
  );
}

/** 커뮤니티 삭제 (소유자만). 실수로 지우지 않게 이름을 그대로 입력해야 한다 */
function DeleteCommunity({ community }: { community: CommunitySummary }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { error, run } = useRequest();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const remove = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await run(
      () => apiFetch(`/communities/${community.id}`, { method: 'DELETE' }),
      '커뮤니티를 삭제하지 못했습니다.',
    );
    setBusy(false);
    if (!ok) return;
    // 목록에서 빠지면 이 설정 창도 함께 사라진다.
    queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
      list?.filter((c) => c.id !== community.id),
    );
    navigate('/');
  };

  return (
    <form className="danger-zone" onSubmit={(e) => void remove(e)}>
      <h3>커뮤니티 삭제</h3>
      <p className="form__hint">
        모든 채널, 메시지, 첨부 파일, 광장 에셋과 맵이 지워지고 되돌릴 수 없습니다. 확인하려면
        커뮤니티 이름 <strong>{community.name}</strong>을(를) 입력하세요.
      </p>
      <div className="settings__row">
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={community.name}
          aria-label="삭제할 커뮤니티 이름"
        />
        <button className="button button--danger" disabled={busy || confirm !== community.name}>
          커뮤니티 삭제
        </button>
      </div>
      {error && (
        <p className="form__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** 요청 후 커뮤니티 정보(역할, 채널)와 멤버를 새로 받는다. 서버도 community:updated로 알린다 */
function useRefresh(communityId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.communities });
    void queryClient.invalidateQueries({ queryKey: queryKeys.members(communityId) });
  };
}

function useRequest() {
  const [error, setError] = useState<string | null>(null);
  const run = async (request: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await request();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
      return false;
    }
  };
  return { error, run };
}

function RolesTab({ community }: { community: CommunitySummary }) {
  const refresh = useRefresh(community.id);
  const { error, run } = useRequest();
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);

  const sort = useDragSort(
    community.roles.map((r) => r.id),
    (ids) =>
      void run(
        () =>
          apiFetch(`/communities/${community.id}/roles/order`, {
            method: 'PUT',
            ...jsonBody({ ids }),
          }),
        '순서를 바꾸지 못했습니다.',
      ).then(refresh),
  );

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () =>
        apiFetch<RoleDto>(`/communities/${community.id}/roles`, {
          method: 'POST',
          ...jsonBody({ name, color }),
        }),
      '역할을 만들지 못했습니다.',
    );
    if (ok) {
      setName('');
      refresh();
    }
  };

  return (
    <div className="form">
      <p className="form__hint">
        왼쪽 손잡이를 끌어 순서를 바꿀 수 있습니다. 역할을 만들어 멤버에게 주면, 비공개 채널을 그
        역할을 가진 멤버에게만 보여 줄 수 있습니다. 이름 색은 가진 역할 중 가장 위 역할의 색을
        따릅니다.
      </p>
      {community.roles.length === 0 && <p className="settings__empty">아직 역할이 없습니다.</p>}
      <ul className="role-list">
        {community.roles.map((role) => (
          <RoleRow
            key={role.id}
            sortProps={sort.itemProps(role.id)}
            communityId={community.id}
            role={role}
            onError={run}
            onDone={refresh}
          />
        ))}
      </ul>
      <form className="role-form" onSubmit={create}>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="새 역할 색"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="새 역할 이름"
          maxLength={30}
          aria-label="새 역할 이름"
        />
        <button className="button button--primary" disabled={!name.trim()}>
          만들기
        </button>
      </form>
      {error && <p className="form__error">{error}</p>}
    </div>
  );
}

function RoleRow({
  communityId,
  role,
  onError,
  onDone,
  sortProps,
}: {
  communityId: string;
  role: RoleDto;
  sortProps: ReturnType<ReturnType<typeof useDragSort>['itemProps']>;
  onError: ReturnType<typeof useRequest>['run'];
  onDone(): void;
}) {
  const [name, setName] = useState(role.name);
  const colorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const url = `/communities/${communityId}/roles/${role.id}`;

  const update = async (patch: { name?: string; color?: string }) => {
    const ok = await onError(
      () => apiFetch(url, { method: 'PATCH', ...jsonBody(patch) }),
      '역할을 바꾸지 못했습니다.',
    );
    if (ok) onDone();
    else setName(role.name);
  };

  const remove = async () => {
    if (
      !window.confirm(
        `"${role.name}" 역할을 지울까요? 이 역할로 보던 비공개 채널은 볼 수 없게 됩니다.`,
      )
    ) {
      return;
    }
    if (await onError(() => apiFetch(url, { method: 'DELETE' }), '역할을 지우지 못했습니다.')) {
      onDone();
    }
  };

  return (
    <li className="role-list__item" {...sortProps}>
      <span className="drag-handle" aria-hidden title="끌어서 순서 바꾸기">
        <GripVertical />
      </span>
      <input
        type="color"
        defaultValue={role.color ?? DEFAULT_COLOR}
        // 색을 고르는 동안 요청이 쏟아지지 않게, 움직임이 멈추면 한 번만 보낸다.
        onChange={(e) => {
          const color = e.target.value;
          clearTimeout(colorTimer.current);
          colorTimer.current = setTimeout(() => void update({ color }), 400);
        }}
        aria-label={`${role.name} 색`}
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== role.name && void update({ name })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        maxLength={30}
        aria-label="역할 이름"
      />
      <button
        type="button"
        className="icon-button role-list__remove"
        onClick={() => void remove()}
        aria-label={`${role.name} 지우기`}
        title="지우기"
      >
        <X aria-hidden />
      </button>
    </li>
  );
}

function MembersTab({ community }: { community: CommunitySummary }) {
  const members = useMembers(community.id);
  const refresh = useRefresh(community.id);
  const { error, run } = useRequest();
  const isOwner = community.myRole === CommunityRole.Owner;

  const toggleRole = async (member: CommunityMember, roleId: string) => {
    const roleIds = member.roleIds.includes(roleId)
      ? member.roleIds.filter((id) => id !== roleId)
      : [...member.roleIds, roleId];
    const ok = await run(
      () =>
        apiFetch(`/communities/${community.id}/members/${member.user.id}/roles`, {
          method: 'PUT',
          ...jsonBody({ roleIds }),
        }),
      '역할을 주지 못했습니다.',
    );
    if (ok) refresh();
  };

  const me = useMeRequired();
  /** 내보낼 수 있는지: 나와 소유자는 안 되고, 관리자는 소유자만 내보낸다 */
  const canKick = (member: CommunityMember) =>
    member.user.id !== me.id &&
    member.role !== CommunityRole.Owner &&
    (member.role !== CommunityRole.Admin || isOwner);

  const kick = async (member: CommunityMember) => {
    if (
      !window.confirm(
        `${displayName(member.user)}님을 커뮤니티에서 내보낼까요? 초대 링크로 다시 들어올 수 있습니다.`,
      )
    ) {
      return;
    }
    const ok = await run(
      () =>
        apiFetch(`/communities/${community.id}/members/${member.user.id}`, { method: 'DELETE' }),
      '내보내지 못했습니다.',
    );
    if (ok) refresh();
  };

  const toggleAdmin = async (member: CommunityMember) => {
    const ok = await run(
      () =>
        apiFetch(`/communities/${community.id}/members/${member.user.id}/admin`, {
          method: 'PUT',
          ...jsonBody({ admin: member.role !== CommunityRole.Admin }),
        }),
      '관리자를 바꾸지 못했습니다.',
    );
    if (ok) refresh();
  };

  return (
    <div className="form">
      <p className="form__hint">
        관리자는 역할과 채널을 관리하고 모든 비공개 채널을 봅니다. 관리자는 소유자만 정할 수
        있습니다.
      </p>
      {!members.data && <p className="form__hint">불러오는 중…</p>}
      <ul className="member-roles">
        {members.data?.map((member) => (
          <li key={member.user.id} className="member-roles__item">
            <div className="member-roles__who">
              <Avatar user={member.user} size={24} />
              <span>{displayName(member.user)}</span>
              {member.role === CommunityRole.Owner && <span className="members__role">소유자</span>}
              {isOwner && member.role !== CommunityRole.Owner && (
                <label className="member-roles__admin">
                  <input
                    type="checkbox"
                    checked={member.role === CommunityRole.Admin}
                    onChange={() => void toggleAdmin(member)}
                  />
                  관리자
                </label>
              )}
              {!isOwner && member.role === CommunityRole.Admin && (
                <span className="members__role">관리자</span>
              )}
              {canKick(member) && (
                <button
                  type="button"
                  className="member-roles__kick"
                  onClick={() => void kick(member)}
                >
                  내보내기
                </button>
              )}
            </div>
            {community.roles.length > 0 && (
              <div className="member-roles__chips">
                {community.roles.map((role) => (
                  <label
                    key={role.id}
                    className="role-chip"
                    style={{ '--role-color': role.color ?? 'var(--muted)' } as CSSProperties}
                  >
                    <input
                      type="checkbox"
                      checked={member.roleIds.includes(role.id)}
                      onChange={() => void toggleRole(member, role.id)}
                    />
                    {role.name}
                  </label>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="form__error">{error}</p>}
    </div>
  );
}
