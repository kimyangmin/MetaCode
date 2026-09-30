import { initials } from '@metacode/client';
import { hasUnread } from '@metacode/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCommunities, useDms } from '../api/queries';
import { CreateCommunitySheet } from '../features/communities/CreateCommunitySheet';
import { useTheme } from '../ui/theme';
import { RAIL_WIDTH } from './AppShell';

/**
 * 가장 왼쪽 세로 막대: DM, 내 커뮤니티들, 커뮤니티 추가 (웹 CommunityRail과 같음).
 * 커뮤니티를 눌러도 서랍은 열어 둔다 (그 커뮤니티의 채널을 고를 수 있게).
 */
export function Rail({ activeCommunityId }: { activeCommunityId: string | null }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const communities = useCommunities();
  const dms = useDms();
  const dmUnread = dms.data?.some(hasUnread) ?? false;
  const [creating, setCreating] = useState(false);

  return (
    <ScrollView
      style={{ width: RAIL_WIDTH, backgroundColor: theme.bgRail }}
      contentContainerStyle={[styles.list, { paddingTop: insets.top + 12, paddingBottom: 12 }]}
      showsVerticalScrollIndicator={false}
    >
      <RailItem
        active={activeCommunityId === null}
        unread={dmUnread}
        label="다이렉트 메시지"
        onPress={() => router.replace('/dm')}
      >
        <Text style={[styles.initials, { color: theme.fg }]}>DM</Text>
      </RailItem>
      <View style={[styles.divider, { backgroundColor: theme.border }]} />
      {communities.data?.map((c) => (
        <RailItem
          key={c.id}
          active={c.id === activeCommunityId}
          unread={c.channels.some(hasUnread)}
          label={c.name}
          onPress={() => router.replace(`/c/${c.id}`)}
        >
          {c.iconUrl ? (
            <Image source={{ uri: c.iconUrl }} style={StyleSheet.absoluteFill} />
          ) : (
            <Text style={[styles.initials, { color: theme.fg }]}>{initials(c.name)}</Text>
          )}
        </RailItem>
      ))}
      <RailItem
        active={false}
        unread={false}
        label="커뮤니티 만들기 또는 참여하기"
        onPress={() => setCreating(true)}
      >
        <Plus color={theme.ok} size={22} />
      </RailItem>
      <CreateCommunitySheet visible={creating} onClose={() => setCreating(false)} />
    </ScrollView>
  );
}

function RailItem({
  active,
  unread,
  label,
  onPress,
  children,
}: {
  active: boolean;
  unread: boolean;
  label: string;
  onPress(): void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.itemRow}>
      {/* 고른 곳은 왼쪽에 긴 막대, 안 읽은 곳은 짧은 점 (Discord와 같음) */}
      {(active || unread) && (
        <View
          style={[styles.pill, { height: active ? 36 : 8, backgroundColor: theme.fg }]}
          pointerEvents="none"
        />
      )}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        style={({ pressed }) => [
          styles.item,
          {
            backgroundColor: active ? theme.accent : theme.bgActive,
            borderRadius: active ? 16 : 24,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        {children}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { alignItems: 'center', gap: 8 },
  itemRow: { width: RAIL_WIDTH, alignItems: 'center', justifyContent: 'center' },
  pill: {
    position: 'absolute',
    left: 0,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  item: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: { fontSize: 16, fontWeight: '700' },
  divider: { width: 32, height: 2, borderRadius: 1, marginVertical: 2 },
});
