import type { UserDetail } from '@metacode/shared';
import { Slot, useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCommunities, useMe } from '@/api/queries';
import { MemberList } from '@/features/communities/MemberList';
import { CommunitySidebar } from '@/features/communities/CommunitySidebar';
import { DmSidebar } from '@/features/dms/DmSidebar';
import { AppShell } from '@/layout/AppShell';
import { Rail } from '@/layout/Rail';
import { UserPanel } from '@/layout/UserPanel';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';
import { useUiStore } from '@/stores/ui';
import { useTheme } from '@/ui/theme';

/** 로그인 후 화면: 내 정보를 받고, 실시간 연결을 열고, 서랍 틀 안에 화면을 그린다 */
export default function MainLayout() {
  const theme = useTheme();
  const me = useMe();

  if (!me.data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        {me.error ? (
          <>
            <Text style={{ color: theme.muted }}>{me.error.message}</Text>
            <Pressable onPress={() => void me.refetch()} style={styles.retry}>
              <Text style={{ color: theme.accent }}>다시 시도</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={theme.muted} />
        )}
      </View>
    );
  }
  return (
    <RealtimeProvider meId={me.data.id}>
      <Shell me={me.data} />
    </RealtimeProvider>
  );
}

function Shell({ me }: { me: UserDetail }) {
  const theme = useTheme();
  const pathname = usePathname();
  const { communityId, channelId } = useGlobalSearchParams<{
    communityId?: string;
    channelId?: string;
  }>();
  const inCommunity = pathname.startsWith('/c/');
  const community = useCommunities().data?.find((c) => c.id === communityId);

  // 다른 화면으로 옮기면 멤버 서랍은 닫는다 (목록 서랍은 커뮤니티를 오가는 동안 열어 둔다)
  useEffect(() => useUiStore.getState().setMembersOpen(false), [pathname]);

  const nav = (
    <View style={styles.nav}>
      <Rail activeCommunityId={inCommunity ? (communityId ?? null) : null} />
      <View style={[styles.sidebar, { backgroundColor: theme.bgSidebar }]}>
        {inCommunity ? (
          community ? (
            <CommunitySidebar community={community} activeChannelId={channelId ?? null} />
          ) : (
            <View style={styles.center} />
          )
        ) : (
          <DmSidebar meId={me.id} activeId={channelId ?? null} />
        )}
        <UserPanel me={me} />
      </View>
    </View>
  );

  return (
    <AppShell nav={nav} members={community ? <MemberList communityId={community.id} /> : null}>
      <Slot />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  retry: { padding: 8 },
  nav: { flex: 1, flexDirection: 'row' },
  sidebar: { flex: 1 },
});
