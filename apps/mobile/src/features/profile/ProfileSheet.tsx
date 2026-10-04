import { displayName, friendStatusOf, memberColor, useIsOnline } from '@metacode/client';
import {
  type AssetDto,
  type UserDetail,
  type UserProfile,
  characterPalette,
  defaultCharacter,
  isBuiltinRef,
} from '@metacode/shared';
import { builtinAsset } from '@metacode/shared/builtin-assets';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, apiFetch } from '../../api/client';
import {
  acceptFriend,
  removeFriend,
  sendFriendRequest,
  useFriends,
  useOpenDm,
} from '../../api/friends';
import { useCommunities, useMe, useMembers } from '../../api/queries';
import { useProfileStore } from '../../stores/profile';
import { AssetPreview } from '../../ui/AssetPreview';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/controls';
import { OverlaySheet } from '../../ui/OverlaySheet';
import { useTheme } from '../../ui/theme';

const ROLE_LABEL = { OWNER: '소유자', ADMIN: '관리자', MEMBER: '' } as const;

/**
 * 사용자 정보 시트 (웹 ProfilePopup의 휴대폰판): 아바타(누르면 크게), 닉네임, 사용자 ID(누르면 GitHub),
 * 온라인 여부, 자기소개, (커뮤니티에서 열었으면) 역할, 광장 캐릭터, 메시지 보내기·친구 버튼.
 */
export function ProfileSheet() {
  const target = useProfileStore((s) => s.target);
  const close = useProfileStore((s) => s.close);
  return (
    <OverlaySheet visible={target !== null} onClose={close}>
      {target && (
        <ProfileBody key={target.user.id} user={target.user} communityId={target.communityId} />
      )}
    </OverlaySheet>
  );
}

function ProfileBody({ user, communityId }: { user: UserProfile; communityId?: string }) {
  const theme = useTheme();
  const close = useProfileStore((s) => s.close);
  const me = useMe().data;
  const online = useIsOnline(user.id);
  const openDm = useOpenDm();
  const members = useMembers(communityId);
  const community = useCommunities().data?.find((c) => c.id === communityId);
  const member = members.data?.find((m) => m.user.id === user.id);
  const roles = community?.roles.filter((r) => member?.roleIds.includes(r.id)) ?? [];
  const color = member && community ? memberColor(member.roleIds, community.roles) : null;
  const [zoom, setZoom] = useState(false);
  // 자기소개는 메시지·멤버 목록에 들고 다니지 않고 열 때 받는다 (웹과 같음)
  const detail = useQuery({
    queryKey: ['user-detail', user.id],
    queryFn: () => apiFetch<UserDetail>(`/users/${user.id}`),
    staleTime: 60_000,
  });
  const isMe = user.id === me?.id;
  const bio = isMe ? me?.bio : detail.data?.bio;

  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.content}>
      <View style={styles.head}>
        <Pressable onPress={() => setZoom(true)} accessibilityLabel="프로필 사진 크게 보기">
          <Avatar user={user} size={72} animate showPresence />
        </Pressable>
        <View style={styles.names}>
          <Text style={[styles.name, { color: color ?? theme.fg }]} numberOfLines={1}>
            {displayName(user)}
          </Text>
          <Text
            style={{ color: theme.accent, fontSize: 14 }}
            onPress={() =>
              void Linking.openURL(`https://github.com/${encodeURIComponent(user.username)}`)
            }
          >
            @{user.username}
          </Text>
          <Text style={{ color: online ? theme.ok : theme.muted, fontSize: 13 }}>
            {online ? '온라인' : '오프라인'}
          </Text>
        </View>
      </View>
      {bio ? <Text style={[styles.bio, { color: theme.fg }]}>{bio}</Text> : null}
      {member && (ROLE_LABEL[member.role] || roles.length > 0) && (
        <View style={styles.roles} accessibilityLabel="역할">
          {ROLE_LABEL[member.role] ? <RoleTag name={ROLE_LABEL[member.role]} /> : null}
          {roles.map((role) => (
            <RoleTag key={role.id} name={role.name} color={role.color} />
          ))}
        </View>
      )}
      <View style={[styles.stage, { backgroundColor: theme.bgInput }]} accessibilityLabel="캐릭터">
        <ProfileCharacter user={user} />
      </View>
      {!isMe && (
        <View style={styles.actions}>
          <Button
            label="메시지 보내기"
            variant="primary"
            onPress={() => {
              close();
              void openDm([user.id]).catch(() => Alert.alert('대화를 열지 못했습니다'));
            }}
          />
          <FriendButton user={user} />
        </View>
      )}
      <AvatarZoom user={user} visible={zoom} onClose={() => setZoom(false)} />
    </ScrollView>
  );
}

function RoleTag({ name, color }: { name: string; color?: string | null }) {
  const theme = useTheme();
  return (
    <View style={[styles.role, { borderColor: theme.border, backgroundColor: theme.bgInput }]}>
      <View style={[styles.roleDot, { backgroundColor: color ?? theme.muted }]} />
      <Text style={{ color: theme.fg, fontSize: 12 }}>{name}</Text>
    </View>
  );
}

/** 친구 추가 / 요청 취소 / 요청 수락 / 친구 끊기 (웹 FriendButton) */
function FriendButton({ user }: { user: UserProfile }) {
  const queryClient = useQueryClient();
  const friends = useFriends();
  const status = friendStatusOf(friends.data, user.id);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      Alert.alert('처리하지 못했습니다', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  if (status === 'none') {
    return (
      <Button
        label="친구 추가"
        busy={busy}
        disabled={friends.isPending}
        onPress={() => void run(() => sendFriendRequest(queryClient, user.username))}
      />
    );
  }
  if (status === 'outgoing') {
    return (
      <Button
        label="요청 보냄 · 취소"
        busy={busy}
        onPress={() => void run(() => removeFriend(queryClient, user.id))}
      />
    );
  }
  if (status === 'incoming') {
    return (
      <Button
        label="친구 요청 수락"
        variant="primary"
        busy={busy}
        onPress={() => void run(() => acceptFriend(queryClient, user.id))}
      />
    );
  }
  return (
    <Button
      label="친구 · 끊기"
      busy={busy}
      onPress={() =>
        Alert.alert('친구 끊기', '친구를 끊을까요?', [
          { text: '취소', style: 'cancel' },
          {
            text: '끊기',
            style: 'destructive',
            onPress: () => void run(() => removeFriend(queryClient, user.id)),
          },
        ])
      }
    />
  );
}

/**
 * 그 사람이 광장에서 쓰는 캐릭터(고른 색 그대로)가 걷는 모습 (웹 ProfileCharacter). 직접 그린 캐릭터는 광장과
 * 같은 캐시로 받고, 받기 전에는 사용자 ID로 고른 기본 캐릭터.
 */
function ProfileCharacter({ user }: { user: UserProfile }) {
  const fallback = defaultCharacter(user.id);
  const choice = user.character ?? fallback;
  const builtin = isBuiltinRef(choice.asset) ? builtinAsset(choice.asset) : undefined;
  const custom = useQuery({
    queryKey: ['assets', 'one', choice.asset, user.character?.version ?? ''],
    queryFn: () => apiFetch<AssetDto>(`/assets/${choice.asset}`),
    enabled: !builtin,
    staleTime: Infinity,
  });
  const loaded = builtin ?? custom.data?.manifest;
  const manifest = loaded ?? builtinAsset(fallback.asset)!;
  const colors = loaded ? choice.colors : fallback.colors;
  return (
    <AssetPreview
      manifest={manifest}
      box={88}
      animation="walk-down"
      palette={characterPalette(manifest, colors)}
    />
  );
}

/** 프로필 사진 크게 보기 (움직이는 사진이면 그것, GitHub 사진은 큰 것으로) */
function AvatarZoom({
  user,
  visible,
  onClose,
}: {
  user: UserProfile;
  visible: boolean;
  onClose(): void;
}) {
  const insets = useSafeAreaInsets();
  const uri = user.avatarAnimatedUrl ?? largeAvatarUrl(user.avatarUrl);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.zoom} onPress={onClose} accessibilityLabel="닫기">
        <Image source={{ uri }} style={styles.zoomImage} contentFit="contain" />
        <View style={[styles.zoomClose, { top: insets.top + 12 }]}>
          <X color="#fff" size={26} />
        </View>
      </Pressable>
    </Modal>
  );
}

/** GitHub 사진은 크기를 붙여 선명한 것을 받는다 (웹 largeAvatarUrl과 같음) */
function largeAvatarUrl(url: string): string {
  if (!url.includes('avatars.githubusercontent.com')) return url;
  const parsed = new URL(url);
  parsed.searchParams.set('s', '512');
  return parsed.toString();
}

const styles = StyleSheet.create({
  body: { maxHeight: 560 },
  content: { gap: 14, paddingBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  names: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 20, fontWeight: '700' },
  bio: { fontSize: 15, lineHeight: 21 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  role: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  roleDot: { width: 8, height: 8, borderRadius: 4 },
  stage: { height: 112, borderRadius: 10, alignItems: 'center', justifyContent: 'flex-end' },
  actions: { gap: 8 },
  zoom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  zoomImage: { width: '100%', height: '80%' },
  zoomClose: { position: 'absolute', right: 16 },
});
