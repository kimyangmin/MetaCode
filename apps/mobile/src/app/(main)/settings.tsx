import { displayName } from '@metacode/client';
import { router } from 'expo-router';
import {
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  LogOut,
  PersonStanding,
  SunMoon,
  X,
} from 'lucide-react-native';
import { type ComponentType, useCallback, useEffect, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMe } from '@/api/queries';
import { signOut } from '@/auth/session';
import { AccountSettings } from '@/features/settings/AccountSettings';
import { AppearanceSettings } from '@/features/settings/AppearanceSettings';
import { CharacterSettings } from '@/features/settings/CharacterSettings';
import { useUiStore } from '@/stores/ui';
import { Avatar } from '@/ui/Avatar';
import { useTheme } from '@/ui/theme';

type Section = 'account' | 'character' | 'appearance';

const SECTIONS: {
  title: string;
  items: { id: Section; label: string; icon: ComponentType<{ color: string; size: number }> }[];
}[] = [
  {
    title: '사용자 설정',
    items: [
      { id: 'account', label: '내 계정', icon: CircleUserRound },
      { id: 'character', label: '캐릭터', icon: PersonStanding },
    ],
  },
  { title: '앱 설정', items: [{ id: 'appearance', label: '화면', icon: SunMoon }] },
];

const LABEL: Record<Section, string> = {
  account: '내 계정',
  character: '캐릭터',
  appearance: '화면',
};

/**
 * 설정 (웹 설정 창의 휴대폰 화면처럼 두 화면): 목록(내 프로필 카드, 항목, 로그아웃) → 항목을 누르면 내용.
 * 내용에서 뒤로 가기는 목록으로, 목록에서 뒤로 가기·✕는 설정을 열기 전 화면으로 돌아간다.
 */
export default function Settings() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const me = useMe().data;
  const [section, setSection] = useState<Section | null>(null);

  const leave = useCallback(() => {
    const back = useUiStore.getState().settingsReturn;
    router.replace((back ?? '/') as '/');
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (section) setSection(null);
      else leave();
      return true;
    });
    return () => sub.remove();
  }, [section, leave]);

  if (!me) return null;
  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top, borderBottomColor: theme.border, backgroundColor: theme.bg },
        ]}
      >
        <Pressable
          onPress={() => (section ? setSection(null) : leave())}
          hitSlop={8}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={section ? '설정 목록으로' : '설정 닫기'}
        >
          {section ? (
            <ChevronLeft color={theme.muted} size={24} />
          ) : (
            <X color={theme.muted} size={22} />
          )}
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.fg }]}>
          {section ? LABEL[section] : '설정'}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {section === null && (
          <>
            <Pressable
              onPress={() => setSection('account')}
              style={({ pressed }) => [
                styles.card,
                styles.profile,
                { backgroundColor: pressed ? theme.bgHover : theme.bgSidebar },
              ]}
            >
              <Avatar user={me} size={56} animate />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.profileName, { color: theme.fg }]} numberOfLines={1}>
                  {displayName(me)}
                </Text>
                <Text style={{ color: theme.muted }} numberOfLines={1}>
                  @{me.username}
                </Text>
              </View>
              <ChevronRight color={theme.muted} size={20} />
            </Pressable>
            {SECTIONS.map((group) => (
              <View key={group.title} style={styles.group}>
                <Text style={[styles.groupTitle, { color: theme.muted }]}>{group.title}</Text>
                <View style={[styles.card, { backgroundColor: theme.bgSidebar }]}>
                  {group.items.map((item, i) => (
                    <Pressable
                      key={item.id}
                      onPress={() => setSection(item.id)}
                      style={({ pressed }) => [
                        styles.item,
                        i > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: theme.border,
                        },
                        pressed && { backgroundColor: theme.bgHover },
                      ]}
                    >
                      <item.icon color={theme.muted} size={20} />
                      <Text style={[styles.itemLabel, { color: theme.fg }]}>{item.label}</Text>
                      <ChevronRight color={theme.muted} size={18} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
            <Pressable
              onPress={() =>
                Alert.alert('로그아웃', '로그아웃할까요?', [
                  { text: '취소', style: 'cancel' },
                  { text: '로그아웃', style: 'destructive', onPress: () => void signOut() },
                ])
              }
              style={({ pressed }) => [
                styles.card,
                styles.item,
                { backgroundColor: pressed ? theme.bgHover : theme.bgSidebar },
              ]}
            >
              <LogOut color={theme.danger} size={20} />
              <Text style={[styles.itemLabel, { color: theme.danger }]}>로그아웃</Text>
            </Pressable>
          </>
        )}
        {section === 'account' && <AccountSettings me={me} />}
        {section === 'character' && <CharacterSettings me={me} />}
        {section === 'appearance' && <AppearanceSettings />}
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  body: { padding: 16, gap: 16 },
  card: { borderRadius: 12, overflow: 'hidden' },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  profileName: { fontSize: 17, fontWeight: '700' },
  group: { gap: 6 },
  groupTitle: { fontSize: 12, fontWeight: '700', marginLeft: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  itemLabel: { flex: 1, fontSize: 15 },
});
