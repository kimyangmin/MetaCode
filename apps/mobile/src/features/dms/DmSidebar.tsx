import { dmTitle } from '@metacode/client';
import { type DmSummary, hasUnread } from '@metacode/shared';
import { router } from 'expo-router';
import { Users } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDms } from '../../api/queries';
import { useUiStore } from '../../stores/ui';
import { Avatar } from '../../ui/Avatar';
import { useTheme } from '../../ui/theme';

/** DM 목록 (웹 DmSidebar): 친구 화면, 대화들. 고르면 서랍을 닫는다 */
export function DmSidebar({ meId, activeId }: { meId: string; activeId: string | null }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const dms = useDms();

  const go = (path: '/dm' | `/dm/${string}`) => {
    router.replace(path);
    useUiStore.getState().setNavOpen(false);
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.bgSidebar }]}>
      <View
        style={[styles.header, { borderBottomColor: theme.border, paddingTop: insets.top + 12 }]}
      >
        <Text style={[styles.title, { color: theme.fg }]}>다이렉트 메시지</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        <Pressable
          onPress={() => go('/dm')}
          style={({ pressed }) => [
            styles.row,
            {
              backgroundColor:
                activeId === null ? theme.bgActive : pressed ? theme.bgHover : 'transparent',
            },
          ]}
        >
          <Users color={theme.muted} size={20} />
          <Text style={[styles.name, { color: theme.fg }]}>친구</Text>
        </Pressable>
        <Text style={[styles.section, { color: theme.muted }]}>다이렉트 메시지</Text>
        {dms.data?.length === 0 && (
          <Text style={[styles.empty, { color: theme.muted }]}>아직 대화가 없습니다.</Text>
        )}
        {dms.data?.map((dm) => (
          <DmRow
            key={dm.id}
            dm={dm}
            meId={meId}
            active={dm.id === activeId}
            onPress={() => go(`/dm/${dm.id}`)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function DmRow({
  dm,
  meId,
  active,
  onPress,
}: {
  dm: DmSummary;
  meId: string;
  active: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  const first = dm.participants.find((p) => p.id !== meId);
  const unread = !active && hasUnread(dm);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: active ? theme.bgActive : pressed ? theme.bgHover : 'transparent' },
      ]}
    >
      {unread && <View style={[styles.unread, { backgroundColor: theme.fg }]} />}
      {first && <Avatar user={first} size={32} showPresence={dm.type === 'DM'} />}
      <Text
        style={[
          styles.name,
          { color: active || unread ? theme.fg : theme.muted, fontWeight: unread ? '700' : '500' },
        ]}
        numberOfLines={1}
      >
        {dmTitle(dm, meId)}
      </Text>
      {dm.type === 'GROUP_DM' && (
        <Text style={{ color: theme.muted, fontSize: 12 }}>{dm.participants.length}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: '700' },
  list: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 16 },
  section: { fontSize: 12, fontWeight: '700', marginTop: 18, marginBottom: 6, marginLeft: 8 },
  empty: { fontSize: 13, marginLeft: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  unread: { position: 'absolute', left: -8, width: 4, height: 8, borderRadius: 2 },
  name: { flex: 1, fontSize: 15 },
});
