import { isManager } from '@metacode/shared';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCommunities } from '@/api/queries';
import { GeneralTab, PlazaTab } from '@/features/communities/settings/GeneralTab';
import { MembersTab } from '@/features/communities/settings/MembersTab';
import { RolesTab } from '@/features/communities/settings/RolesTab';
import { Segmented } from '@/ui/controls';
import { useTheme } from '@/ui/theme';

type Tab = 'general' | 'plaza' | 'roles' | 'members';

/**
 * 커뮤니티 설정 (소유자·관리자, 웹 CommunitySettings): 일반 · 광장 · 역할 · 멤버.
 * 비공개 채널을 누가 볼지는 채널 설정(채널을 길게 누름)에서 역할로 정한다.
 */
export default function CommunitySettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const communities = useCommunities();
  const community = communities.data?.find((c) => c.id === communityId);
  const [tab, setTab] = useState<Tab>('general');

  const close = () => router.replace(`/c/${communityId}`);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.replace(`/c/${communityId}`);
      return true;
    });
    return () => sub.remove();
  }, [communityId]);

  if (!communities.data) return null;
  // 지워졌거나 관리자가 아니게 되었으면 커뮤니티로
  if (!community || !isManager(community.myRole)) return <Redirect href="/" />;

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top, borderBottomColor: theme.border }]}>
        <Pressable
          onPress={close}
          hitSlop={8}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel="커뮤니티 설정 닫기"
        >
          <X color={theme.muted} size={22} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.fg }]}>커뮤니티 설정</Text>
          <Text style={{ color: theme.muted, fontSize: 12 }} numberOfLines={1}>
            {community.name}
          </Text>
        </View>
      </View>
      <View style={styles.tabs}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'general', label: '일반' },
            { value: 'plaza', label: '광장' },
            { value: 'roles', label: '역할' },
            { value: 'members', label: '멤버' },
          ]}
        />
      </View>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {tab === 'general' && <GeneralTab community={community} />}
        {tab === 'plaza' && <PlazaTab community={community} />}
        {tab === 'roles' && <RolesTab community={community} />}
        {tab === 'members' && <MembersTab community={community} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700' },
  tabs: { paddingHorizontal: 16, paddingTop: 12 },
  body: { padding: 16 },
});
