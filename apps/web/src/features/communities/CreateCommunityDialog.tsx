import type { CommunitySummary } from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, apiFetch } from '../../api/client';
import { jsonBody, queryKeys } from '../../api/queries';
import { Dialog } from '../../ui/Dialog';
import { upsertCommunity } from './hooks';
import { parseInviteCode } from './invite';

export function CreateCommunityDialog({ onClose }: { onClose(): void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (e: FormEvent, action: () => Promise<CommunitySummary>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const community = await action();
      queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
        upsertCommunity(list, community),
      );
      onClose();
      navigate(`/c/${community.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '요청을 처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={mode === 'create' ? '커뮤니티 만들기' : '초대로 참여하기'} onClose={onClose}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')}>
          새로 만들기
        </button>
        <button role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>
          초대 코드로 참여
        </button>
      </div>

      {mode === 'create' ? (
        <form
          className="form"
          onSubmit={(e) =>
            run(e, () =>
              apiFetch<CommunitySummary>('/communities', {
                method: 'POST',
                ...jsonBody({ name }),
              }),
            )
          }
        >
          <label>
            커뮤니티 이름
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
          </label>
          {error && <p className="form__error">{error}</p>}
          <button className="button button--primary" disabled={busy || !name.trim()}>
            만들기
          </button>
        </form>
      ) : (
        <form
          className="form"
          onSubmit={(e) =>
            run(e, () => {
              const code = parseInviteCode(invite);
              if (!code) throw new ApiError(400, '초대 링크나 코드를 확인해 주세요.');
              return apiFetch<CommunitySummary>(`/invites/${code}/accept`, { method: 'POST' });
            })
          }
        >
          <label>
            초대 링크 또는 코드
            <input
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="https://…/invite/AbCd2345"
              required
            />
          </label>
          {error && <p className="form__error">{error}</p>}
          <button className="button button--primary" disabled={busy || !invite.trim()}>
            참여하기
          </button>
        </form>
      )}
    </Dialog>
  );
}
