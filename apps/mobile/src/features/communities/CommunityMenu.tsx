import { queryKeys } from '@metacode/client';
import { type CommunitySummary, CommunityRole, isManager } from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { LogOut, Settings, UserPlus } from 'lucide-react-native';
import { type ComponentType, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { ApiError, apiSend } from '../../api/client';
import { WEB_URL } from '../../config';
import { useUiStore } from '../../stores/ui';
import { Button } from '../../ui/controls';
import { Sheet } from '../../ui/Sheet';
import { useTheme } from '../../ui/theme';

/**
 * 커뮤니티 메뉴 (웹 사이드바 머리글의 ⋯): 초대하기, 커뮤니티 설정(소유자·관리자), 커뮤니티 나가기(소유자 빼고).
 */
export function CommunityMenu({
  community,
  visible,
  onClose,
}: {
  community: CommunitySummary;
  visible: boolean;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const isOwner = community.myRole === CommunityRole.Owner;

  const leave = () => {
    onClose();
    Alert.alert('커뮤니티 나가기', `"${community.name}" 커뮤니티에서 나갈까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '나가기',
        style: 'destructive',
        onPress: () =>
          void apiSend(`/communities/${community.id}/leave`, 'POST')
            .then(() => {
              queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
                list?.filter((c) => c.id !== community.id),
              );
              router.replace('/');
            })
            .catch((e: unknown) =>
              Alert.alert('나가지 못했습니다', e instanceof ApiError ? e.message : undefined),
            ),
      },
    ]);
  };

  const openSettings = () => {
    onClose();
    useUiStore.setState({ navOpen: false });
    router.push({
      pathname: '/community-settings/[communityId]',
      params: { communityId: community.id },
    });
  };

  return (
    <>
      <Sheet visible={visible} title={community.name} onClose={onClose}>
        <MenuItem
          icon={UserPlus}
          label="초대하기"
          onPress={() => {
            onClose();
            setInviting(true);
          }}
        />
        {isManager(community.myRole) && (
          <MenuItem icon={Settings} label="커뮤니티 설정" onPress={openSettings} />
        )}
        {!isOwner && <MenuItem icon={LogOut} label="커뮤니티 나가기" danger onPress={leave} />}
      </Sheet>
      {inviting && <InviteSheet communityId={community.id} onClose={() => setInviting(false)} />}
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  danger,
  onPress,
}: {
  icon: ComponentType<{ color: string; size: number }>;
  label: string;
  danger?: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  const color = danger ? theme.danger : theme.fg;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.item, pressed && { backgroundColor: theme.bgHover }]}
    >
      <Icon color={danger ? theme.danger : theme.muted} size={22} />
      <Text style={{ color, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

/** 초대하기 (웹 InviteDialog): 7일짜리 초대 링크를 만들어 복사하거나 공유한다 */
function InviteSheet({ communityId, onClose }: { communityId: string; onClose(): void }) {
  const theme = useTheme();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const invite = await apiSend<{ code: string }>(`/communities/${communityId}/invites`, 'POST');
      setLink(`${WEB_URL}/invite/${invite.code}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '초대 링크를 만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible title="초대하기" onClose={onClose}>
      <Text style={{ color: theme.muted }}>
        이 링크를 받은 사람은 7일 동안 커뮤니티에 들어올 수 있습니다.
      </Text>
      {link ? (
        <>
          <Text
            selectable
            style={[styles.link, { color: theme.fg, backgroundColor: theme.bgInput }]}
          >
            {link}
          </Text>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button
                label={copied ? '복사했습니다' : '복사'}
                onPress={() => {
                  void Clipboard.setStringAsync(link);
                  setCopied(true);
                }}
              />
            </View>
            <View style={styles.flex}>
              <Button
                label="공유"
                variant="primary"
                onPress={() => void Share.share({ message: link })}
              />
            </View>
          </View>
        </>
      ) : (
        <Button
          label="초대 링크 만들기"
          variant="primary"
          busy={busy}
          onPress={() => void create()}
        />
      )}
      {error && <Text style={{ color: theme.danger }}>{error}</Text>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 50,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  link: { fontSize: 14, padding: 12, borderRadius: 8 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
