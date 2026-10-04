import { queryKeys } from '@metacode/client';
import type { CommunitySummary, InviteInfo } from '@metacode/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, apiFetch, apiSend } from '../../api/client';
import { Button } from '../../ui/controls';
import { mc, useTheme } from '../../ui/theme';

/**
 * 초대 화면 (웹 초대 페이지): 커뮤니티 아이콘·이름·멤버 수를 보여 주고 참여한다. 이미 멤버면 바로 그 커뮤니티로 간다.
 */
export function InviteScreen({ code }: { code: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const info = useQuery({
    queryKey: ['invite', code],
    queryFn: () => apiFetch<InviteInfo>(`/invites/${code}`),
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (communityId: string) => router.replace(`/c/${communityId}`);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const community = await apiSend<CommunitySummary>(`/invites/${code}/accept`, 'POST');
      queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
        !list
          ? [community]
          : list.some((c) => c.id === community.id)
            ? list.map((c) => (c.id === community.id ? community : c))
            : [...list, community],
      );
      open(community.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '참여하지 못했습니다.');
      setBusy(false);
    }
  };

  const data = info.data;
  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: mc.night,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View style={[styles.card, { backgroundColor: theme.bgSidebar }]}>
        {info.isPending && <ActivityIndicator color={theme.muted} />}
        {info.isError && (
          <>
            <Text style={[styles.title, { color: theme.fg }]}>초대를 찾을 수 없습니다</Text>
            <Text style={{ color: theme.muted, textAlign: 'center' }}>
              {info.error instanceof ApiError && info.error.status !== 404
                ? info.error.message
                : '만료되었거나 없는 초대 링크입니다.'}
            </Text>
            <Button label="처음으로" onPress={() => router.replace('/')} />
          </>
        )}
        {data && (
          <>
            <Text style={{ color: theme.muted }}>커뮤니티 초대</Text>
            {data.communityIconUrl ? (
              <Image source={{ uri: data.communityIconUrl }} style={styles.icon} />
            ) : (
              <View style={[styles.icon, styles.initials, { backgroundColor: theme.bgActive }]}>
                <Text style={{ color: theme.fg, fontSize: 28, fontWeight: '700' }}>
                  {data.communityName.slice(0, 2)}
                </Text>
              </View>
            )}
            <Text style={[styles.title, { color: theme.fg }]} numberOfLines={2}>
              {data.communityName}
            </Text>
            <Text style={{ color: theme.muted }}>멤버 {data.memberCount}명</Text>
            {error && <Text style={{ color: theme.danger }}>{error}</Text>}
            <View style={styles.actions}>
              {data.joined ? (
                <Button
                  label="커뮤니티로 가기"
                  variant="primary"
                  onPress={() => open(data.communityId)}
                />
              ) : (
                <Button
                  label="참여하기"
                  variant="primary"
                  busy={busy}
                  onPress={() => void join()}
                />
              )}
              <Button label="나중에" disabled={busy} onPress={() => router.replace('/')} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  card: { borderRadius: 16, padding: 24, alignItems: 'center', gap: 12 },
  icon: { width: 88, height: 88, borderRadius: 24 },
  initials: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: 8, marginTop: 8 },
});
