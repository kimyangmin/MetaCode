import { displayName, memberColor, usePresenceStore } from '@metacode/client';
import type { CommunityMember } from '@metacode/shared';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCommunities, useMembers } from '../../api/queries';
import { Avatar } from '../../ui/Avatar';
import { useTheme } from '../../ui/theme';

const ROLE_LABEL = { OWNER: '소유자', ADMIN: '관리자', MEMBER: '' } as const;

/** 오른쪽 서랍: 온라인/오프라인 멤버 (웹 MemberList). 이름 색은 가장 위 역할의 색 */
export function MemberList({ communityId }: { communityId: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const members = useMembers(communityId);
  const online = usePresenceStore((s) => s.online);
  const roles = useCommunities().data?.find((c) => c.id === communityId)?.roles ?? [];

  const isOnline = (m: CommunityMember) => online[m.user.id] ?? m.online;
  const list = members.data ?? [];
  const sections = [
    { title: '온라인', data: list.filter(isOnline) },
    { title: '오프라인', data: list.filter((m) => !isOnline(m)) },
  ].filter((s) => s.data.length > 0);

  return (
    <SectionList
      style={{ backgroundColor: theme.bgSidebar }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}
      sections={sections}
      keyExtractor={(m) => m.user.id}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        <Text style={[styles.section, { color: theme.muted }]}>
          {section.title} — {section.data.length}
        </Text>
      )}
      renderItem={({ item: m }) => (
        <View style={[styles.row, { opacity: isOnline(m) ? 1 : 0.5 }]}>
          <Avatar user={m.user} size={34} showPresence animate />
          <Text
            style={[styles.name, { color: memberColor(m.roleIds, roles) ?? theme.fg }]}
            numberOfLines={1}
          >
            {displayName(m.user)}
          </Text>
          {ROLE_LABEL[m.role] ? (
            <Text style={[styles.role, { color: theme.muted }]}>{ROLE_LABEL[m.role]}</Text>
          ) : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 4, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 48 },
  name: { flex: 1, fontSize: 15, fontWeight: '500' },
  role: { fontSize: 11 },
});
