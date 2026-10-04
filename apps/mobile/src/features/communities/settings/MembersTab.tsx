import { displayName } from '@metacode/client';
import { type CommunityMember, CommunityRole, type CommunitySummary } from '@metacode/shared';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { apiSend } from '../../../api/client';
import { useMe, useMembers } from '../../../api/queries';
import { Avatar } from '../../../ui/Avatar';
import { useTheme } from '../../../ui/theme';
import { RoleChips } from '../ChannelEditor';
import { Hint, StatusText, useRefresh, useRequest } from './shared';

/**
 * 멤버 (웹 MembersTab): 역할 주기, 관리자 정하기(소유자만), 내보내기(관리자는 소유자만 내보냄, 소유자는 못 내보냄).
 */
export function MembersTab({ community }: { community: CommunitySummary }) {
  const theme = useTheme();
  const me = useMe().data;
  const members = useMembers(community.id);
  const refresh = useRefresh(community.id);
  const { status, run } = useRequest();
  const isOwner = community.myRole === CommunityRole.Owner;
  const base = `/communities/${community.id}/members`;

  const toggleRole = (member: CommunityMember, roleId: string) => {
    const roleIds = member.roleIds.includes(roleId)
      ? member.roleIds.filter((id) => id !== roleId)
      : [...member.roleIds, roleId];
    void run(
      () => apiSend(`${base}/${member.user.id}/roles`, 'PUT', { roleIds }),
      '역할을 주지 못했습니다.',
    ).then((ok) => ok && refresh());
  };

  const toggleAdmin = (member: CommunityMember) =>
    void run(
      () =>
        apiSend(`${base}/${member.user.id}/admin`, 'PUT', {
          admin: member.role !== CommunityRole.Admin,
        }),
      '관리자를 바꾸지 못했습니다.',
    ).then((ok) => ok && refresh());

  const canKick = (member: CommunityMember) =>
    member.user.id !== me?.id &&
    member.role !== CommunityRole.Owner &&
    (member.role !== CommunityRole.Admin || isOwner);

  const kick = (member: CommunityMember) =>
    Alert.alert(
      '내보내기',
      `${displayName(member.user)}님을 커뮤니티에서 내보낼까요? 초대 링크로 다시 들어올 수 있습니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '내보내기',
          style: 'destructive',
          onPress: () =>
            void run(
              () => apiSend(`${base}/${member.user.id}`, 'DELETE'),
              '내보내지 못했습니다.',
            ).then((ok) => ok && refresh()),
        },
      ],
    );

  return (
    <View style={styles.root}>
      <Hint>
        관리자는 역할과 채널을 관리하고 모든 비공개 채널을 봅니다. 관리자는 소유자만 정할 수
        있습니다.
      </Hint>
      {!members.data && <Hint>불러오는 중…</Hint>}
      <StatusText status={status} />
      {members.data?.map((member) => (
        <View key={member.user.id} style={[styles.member, { backgroundColor: theme.bgSidebar }]}>
          <View style={styles.who}>
            <Avatar user={member.user} size={32} />
            <Text style={[styles.name, { color: theme.fg }]} numberOfLines={1}>
              {displayName(member.user)}
            </Text>
            {member.role === CommunityRole.Owner && (
              <Text style={{ color: theme.muted, fontSize: 12 }}>소유자</Text>
            )}
            {!isOwner && member.role === CommunityRole.Admin && (
              <Text style={{ color: theme.muted, fontSize: 12 }}>관리자</Text>
            )}
          </View>
          {isOwner && member.role !== CommunityRole.Owner && (
            <View style={styles.adminRow}>
              <Text style={{ flex: 1, color: theme.fg }}>관리자</Text>
              <Switch
                value={member.role === CommunityRole.Admin}
                onValueChange={() => toggleAdmin(member)}
              />
            </View>
          )}
          {community.roles.length > 0 && (
            <RoleChips
              roles={community.roles}
              selected={member.roleIds}
              onToggle={(id) => toggleRole(member, id)}
            />
          )}
          {canKick(member) && (
            <Pressable onPress={() => kick(member)} accessibilityRole="button" hitSlop={6}>
              <Text style={{ color: theme.danger, fontSize: 14 }}>내보내기</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  member: { borderRadius: 10, padding: 12, gap: 10 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontSize: 15, fontWeight: '600' },
  adminRow: { flexDirection: 'row', alignItems: 'center' },
});
