import { displayName, useIsOnline, usePresenceStore } from '@metacode/client';
import type { FriendDto, FriendRequestDto } from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Check, MessageCircle, UserMinus, X } from 'lucide-react-native';
import { type ComponentType, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../../api/client';
import {
  acceptFriend,
  removeFriend,
  sendFriendRequest,
  useFriends,
  useOpenDm,
} from '../../api/friends';
import { openProfile } from '../../stores/profile';
import { Avatar } from '../../ui/Avatar';
import { Button, Segmented, TextField } from '../../ui/controls';
import { useTheme } from '../../ui/theme';

type Tab = 'online' | 'all' | 'pending' | 'add';

/**
 * DM 홈(대화를 고르지 않았을 때)의 친구 화면 (웹 FriendsPanel): 온라인 · 모두 · 대기 중 · 친구 추가.
 * 친구에게 바로 메시지를 보내거나 끊고, 받은 요청은 수락·거절, 보낸 요청은 취소한다.
 */
export function FriendsScreen() {
  const theme = useTheme();
  const friends = useFriends();
  const all = friends.data?.friends ?? [];
  const onlineKey = usePresenceStore((s) =>
    all
      .filter((f) => s.online[f.user.id])
      .map((f) => f.user.id)
      .join(','),
  );
  const online = all.filter((f) => onlineKey.split(',').includes(f.user.id));
  const incoming = friends.data?.incoming.length ?? 0;
  const [tab, setTab] = useState<Tab>(() => (incoming > 0 ? 'pending' : 'online'));
  const list = friends.data;

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'online', label: '온라인' },
            { value: 'all', label: '모두' },
            { value: 'pending', label: incoming > 0 ? `대기 ${incoming}` : '대기 중' },
            { value: 'add', label: '추가' },
          ]}
        />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {friends.isPending && <Text style={{ color: theme.muted }}>불러오는 중…</Text>}
        {friends.isError && (
          <Text style={{ color: theme.danger }}>친구 목록을 불러오지 못했습니다.</Text>
        )}
        {list && tab === 'online' && (
          <FriendList
            title={`온라인 — ${online.length}명`}
            friends={online}
            empty="지금 온라인인 친구가 없습니다."
          />
        )}
        {list && tab === 'all' && (
          <FriendList
            title={`모든 친구 — ${list.friends.length}명`}
            friends={list.friends}
            empty="아직 친구가 없습니다. 추가에서 사용자 ID로 요청해 보세요."
          />
        )}
        {list && tab === 'pending' && (
          <>
            <RequestList
              title={`받은 요청 — ${list.incoming.length}`}
              requests={list.incoming}
              incoming
            />
            <RequestList title={`보낸 요청 — ${list.outgoing.length}`} requests={list.outgoing} />
            {list.incoming.length + list.outgoing.length === 0 && (
              <Text style={[styles.empty, { color: theme.muted }]}>
                대기 중인 친구 요청이 없습니다.
              </Text>
            )}
          </>
        )}
        {tab === 'add' && <AddFriend />}
      </ScrollView>
    </View>
  );
}

function Section({ title }: { title: string }) {
  const theme = useTheme();
  return <Text style={[styles.section, { color: theme.muted }]}>{title}</Text>;
}

function FriendList({
  title,
  friends,
  empty,
}: {
  title: string;
  friends: FriendDto[];
  empty: string;
}) {
  const theme = useTheme();
  return (
    <>
      <Section title={title} />
      {friends.length === 0 ? (
        <Text style={[styles.empty, { color: theme.muted }]}>{empty}</Text>
      ) : (
        friends.map((friend) => <FriendRow key={friend.user.id} friend={friend} />)
      )}
    </>
  );
}

/** 친구 한 명: 누르면 정보, 오른쪽은 메시지 보내기·끊기 */
function FriendRow({ friend }: { friend: FriendDto }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const openDm = useOpenDm();
  const online = useIsOnline(friend.user.id);
  const { user } = friend;
  const confirmRemove = () =>
    Alert.alert('친구 끊기', `${displayName(user)}님과 친구를 끊을까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '끊기',
        style: 'destructive',
        onPress: () => void removeFriend(queryClient, user.id).catch(showError),
      },
    ]);
  return (
    <Row user={user} subtitle={`@${user.username} · ${online ? '온라인' : '오프라인'}`}>
      <IconButton
        icon={MessageCircle}
        label={`${displayName(user)}에게 메시지 보내기`}
        onPress={() => void openDm([user.id]).catch(showError)}
      />
      <IconButton icon={UserMinus} label="친구 끊기" color={theme.muted} onPress={confirmRemove} />
    </Row>
  );
}

function RequestList({
  title,
  requests,
  incoming = false,
}: {
  title: string;
  requests: FriendRequestDto[];
  incoming?: boolean;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  if (requests.length === 0) return null;
  return (
    <>
      <Section title={title} />
      {requests.map(({ user }) => (
        <Row key={user.id} user={user} subtitle={`@${user.username}`}>
          {incoming && (
            <IconButton
              icon={Check}
              label="수락"
              color={theme.ok}
              onPress={() => void acceptFriend(queryClient, user.id).catch(showError)}
            />
          )}
          <IconButton
            icon={X}
            label={incoming ? '거절' : '요청 취소'}
            color={theme.muted}
            onPress={() => void removeFriend(queryClient, user.id).catch(showError)}
          />
        </Row>
      ))}
    </>
  );
}

function AddFriend() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async () => {
    const name = username.trim().replace(/^@/, '');
    if (!name) return;
    setBusy(true);
    setResult(null);
    try {
      const changed = await sendFriendRequest(queryClient, name);
      setResult({
        ok: true,
        text:
          changed.status === 'friends'
            ? `이제 @${name}님과 친구입니다.`
            : `@${name}님에게 친구 요청을 보냈습니다.`,
      });
      setUsername('');
    } catch (error) {
      setResult({
        ok: false,
        text: error instanceof ApiError ? error.message : '요청을 보내지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.add}>
      <Text style={{ color: theme.muted }}>사용자 ID(GitHub 아이디)로 친구 요청을 보냅니다.</Text>
      <TextField
        label="사용자 ID"
        value={username}
        onChangeText={setUsername}
        placeholder="예: octocat"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
      />
      <Button
        label="친구 요청 보내기"
        variant="primary"
        busy={busy}
        disabled={!username.trim()}
        onPress={() => void submit()}
      />
      {result && <Text style={{ color: result.ok ? theme.ok : theme.danger }}>{result.text}</Text>}
    </View>
  );
}

function Row({
  user,
  subtitle,
  children,
}: {
  user: FriendDto['user'];
  subtitle: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Pressable
        onPress={() => openProfile(user)}
        style={styles.who}
        accessibilityRole="button"
        accessibilityLabel={`${displayName(user)} 정보`}
      >
        <Avatar user={user} size={40} showPresence animate />
        <View style={styles.names}>
          <Text style={[styles.name, { color: theme.fg }]} numberOfLines={1}>
            {displayName(user)}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 13 }} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </Pressable>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

function IconButton({
  icon: Icon,
  label,
  color,
  onPress,
}: {
  icon: ComponentType<{ color: string; size: number }>;
  label: string;
  color?: string;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.icon,
        { backgroundColor: pressed ? theme.bgHover : theme.bgSidebar },
      ]}
    >
      <Icon color={color ?? theme.fg} size={20} />
    </Pressable>
  );
}

function showError(error: unknown) {
  Alert.alert('처리하지 못했습니다', error instanceof ApiError ? error.message : undefined);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: { paddingHorizontal: 12, paddingTop: 12 },
  body: { padding: 12, paddingBottom: 32 },
  section: { fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 4 },
  empty: { paddingVertical: 16, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  names: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  add: { gap: 12, paddingTop: 8 },
});
