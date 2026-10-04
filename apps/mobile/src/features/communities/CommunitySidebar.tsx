import {
  type ChannelSummary,
  type ChannelType,
  type CommunitySummary,
  hasUnread,
  isManager,
} from '@metacode/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ellipsis, Hash, Lock, Plus, Volume2 } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUiStore } from '../../stores/ui';
import { useVoiceStore } from '../voice/store';
import { VoiceMembers } from '../voice/VoiceMembers';
import { useVoice } from '../voice/VoiceProvider';
import { useTheme } from '../../ui/theme';
import { ChannelEditor } from './ChannelEditor';
import { CommunityMenu } from './CommunityMenu';

/**
 * 커뮤니티의 채널 목록 (웹 CommunitySidebar): 배너, 이름, 텍스트 채널과 음성 채널.
 * 채널을 고르면 서랍을 닫는다.
 */
export function CommunitySidebar({
  community,
  activeChannelId,
}: {
  community: CommunitySummary;
  activeChannelId: string | null;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const voice = useVoice();
  const calls = useVoiceStore((s) => s.calls);
  const callChannelId = useVoiceStore((s) => s.session?.channelId ?? null);
  const canManage = isManager(community.myRole);
  const [menuOpen, setMenuOpen] = useState(false);
  /** 열린 채널 만들기(종류)·채널 설정(채널) */
  const [editing, setEditing] = useState<
    { type: ChannelType } | { channel: ChannelSummary } | null
  >(null);
  const textChannels = community.channels.filter((c) => c.type === 'TEXT');
  const voiceChannels = community.channels.filter((c) => c.type === 'VOICE');

  const open = (channel: ChannelSummary) => {
    router.replace(`/c/${community.id}/${channel.id}`);
    useUiStore.getState().setNavOpen(false);
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.bgSidebar }]}>
      {community.bannerUrl ? (
        <View style={{ paddingTop: insets.top }}>
          <Image source={{ uri: community.bannerUrl }} style={styles.banner} />
        </View>
      ) : null}
      <View
        style={[
          styles.header,
          {
            borderBottomColor: theme.border,
            paddingTop: community.bannerUrl ? 12 : insets.top + 12,
          },
        ]}
      >
        <Text style={[styles.title, { color: theme.fg }]} numberOfLines={1}>
          {community.name}
        </Text>
        <Pressable
          onPress={() => setMenuOpen(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="커뮤니티 메뉴"
        >
          <Ellipsis color={theme.muted} size={22} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        <SectionHeader
          title="텍스트 채널"
          onAdd={canManage ? () => setEditing({ type: 'TEXT' }) : undefined}
        />
        {textChannels.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            active={channel.id === activeChannelId}
            onPress={() => open(channel)}
            onLongPress={canManage ? () => setEditing({ channel }) : undefined}
          />
        ))}
        {/* 음성 채널이 없어도 관리자에게는 머리글(+)을 보여 준다 (웹과 같음) */}
        {(voiceChannels.length > 0 || canManage) && (
          <SectionHeader
            title="음성 채널"
            onAdd={canManage ? () => setEditing({ type: 'VOICE' }) : undefined}
          />
        )}
        {/* 음성 채널을 누르면 통화에 들어간다 (보던 채팅은 그대로). 참여자는 채널 아래에 */}
        {voiceChannels.map((channel) => (
          <View key={channel.id}>
            <ChannelRow
              channel={channel}
              active={channel.id === callChannelId}
              onPress={() => void voice.join(channel.id)}
              onLongPress={canManage ? () => setEditing({ channel }) : undefined}
            />
            <VoiceMembers channelId={channel.id} members={calls[channel.id]?.members ?? []} />
          </View>
        ))}
      </ScrollView>
      <CommunityMenu community={community} visible={menuOpen} onClose={() => setMenuOpen(false)} />
      {editing && (
        <ChannelEditor
          community={community}
          channel={'channel' in editing ? editing.channel : undefined}
          initialType={'type' in editing ? editing.type : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </View>
  );
}

/** 채널 구역 머리글. 관리자에게는 오른쪽에 + (그 종류로 채널 만들기) */
function SectionHeader({ title, onAdd }: { title: string; onAdd?: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.section, { color: theme.muted }]}>{title}</Text>
      {onAdd && (
        <Pressable
          onPress={onAdd}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`${title} 만들기`}
        >
          <Plus color={theme.muted} size={18} />
        </Pressable>
      )}
    </View>
  );
}

function ChannelRow({
  channel,
  active,
  onPress,
  onLongPress,
}: {
  channel: ChannelSummary;
  active: boolean;
  onPress(): void;
  /** 관리자: 길게 누르면 채널 설정 */
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const unread = !active && channel.type === 'TEXT' && hasUnread(channel);
  const color = active || unread ? theme.fg : theme.muted;
  const Icon = channel.type === 'VOICE' ? Volume2 : Hash;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: active ? theme.bgActive : pressed ? theme.bgHover : 'transparent' },
      ]}
    >
      {unread && <View style={[styles.unread, { backgroundColor: theme.fg }]} />}
      <Icon color={theme.muted} size={18} />
      <Text style={[styles.name, { color, fontWeight: unread ? '700' : '500' }]} numberOfLines={1}>
        {channel.name}
      </Text>
      {channel.private && <Lock color={theme.muted} size={14} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  banner: { width: '100%', aspectRatio: 16 / 9 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 17, fontWeight: '700' },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 6,
    paddingRight: 10,
  },
  list: { paddingHorizontal: 8, paddingBottom: 16 },
  section: { fontSize: 12, fontWeight: '700', marginLeft: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  unread: { position: 'absolute', left: -8, width: 4, height: 8, borderRadius: 2 },
  name: { flex: 1, fontSize: 15 },
});
