import { parseInviteCode, queryKeys } from '@metacode/client';
import { type CommunitySummary, PlazaStyle } from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError, apiFetch, apiSend } from '../../api/client';
import { useUiStore } from '../../stores/ui';
import { Sheet } from '../../ui/Sheet';
import { Button, Segmented, TextField } from '../../ui/controls';
import { useTheme } from '../../ui/theme';

/** 커뮤니티 만들기 또는 초대 코드로 참여 (웹 CreateCommunityDialog) */
export function CreateCommunitySheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [plazaStyle, setPlazaStyle] = useState<PlazaStyle>(PlazaStyle.TopDown);
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (request: () => Promise<CommunitySummary>) => {
    setBusy(true);
    setError(null);
    try {
      const community = await request();
      queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
        !list
          ? [community]
          : list.some((c) => c.id === community.id)
            ? list.map((c) => (c.id === community.id ? community : c))
            : [...list, community],
      );
      setName('');
      setInvite('');
      onClose();
      useUiStore.getState().setNavOpen(false);
      router.replace(`/c/${community.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const join = () => {
    const code = parseInviteCode(invite);
    if (!code) {
      setError('초대 링크나 코드를 확인해 주세요.');
      return;
    }
    void run(() => apiFetch<CommunitySummary>(`/invites/${code}/accept`, { method: 'POST' }));
  };

  return (
    <Sheet visible={visible} title="커뮤니티" onClose={onClose}>
      <Segmented
        value={mode}
        onChange={(m) => (setMode(m), setError(null))}
        options={[
          { value: 'create', label: '새로 만들기' },
          { value: 'join', label: '초대 코드로 참여' },
        ]}
      />
      {mode === 'create' ? (
        <TextField
          label="커뮤니티 이름"
          value={name}
          onChangeText={setName}
          maxLength={50}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() =>
            name.trim() && void run(() => apiSend('/communities', 'POST', { name, plazaStyle }))
          }
        />
      ) : (
        <TextField
          label="초대 링크 또는 코드"
          value={invite}
          onChangeText={setInvite}
          placeholder="https://…/invite/AbCd2345"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={join}
        />
      )}
      {mode === 'create' && (
        // 웹 PlazaStylePicker와 같은 선택 (탑다운 / 횡스크롤)
        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.muted, fontSize: 13 }}>광장 방식</Text>
          <Segmented<PlazaStyle>
            value={plazaStyle}
            onChange={setPlazaStyle}
            options={[
              { value: PlazaStyle.TopDown, label: '탑다운' },
              { value: PlazaStyle.SideScroll, label: '횡스크롤' },
            ]}
          />
          <Text style={{ color: theme.muted, fontSize: 12 }}>
            {plazaStyle === PlazaStyle.SideScroll
              ? '옆에서 보는 광장. 좌우로 걷고 점프해서 발판에 오릅니다.'
              : '위에서 내려다보는 광장. 방향키로 네 방향을 걷습니다.'}
          </Text>
        </View>
      )}
      {error && <Text style={{ color: theme.danger }}>{error}</Text>}
      {mode === 'create' ? (
        <Button
          label="만들기"
          variant="primary"
          busy={busy}
          disabled={!name.trim()}
          onPress={() => void run(() => apiSend('/communities', 'POST', { name, plazaStyle }))}
        />
      ) : (
        <Button
          label="참여하기"
          variant="primary"
          busy={busy}
          disabled={!invite.trim()}
          onPress={join}
        />
      )}
    </Sheet>
  );
}
