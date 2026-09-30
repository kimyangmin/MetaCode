import { type ChannelSummary, type CommunitySummary, hasUnread } from '@metacode/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Hash, Lock, Volume2 } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUiStore } from '../../stores/ui';
import { useTheme } from '../../ui/theme';

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
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[styles.section, { color: theme.muted }]}>텍스트 채널</Text>
        {textChannels.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            active={channel.id === activeChannelId}
            onPress={() => open(channel)}
          />
        ))}
        {voiceChannels.length > 0 && (
          <Text style={[styles.section, { color: theme.muted }]}>음성 채널</Text>
        )}
        {voiceChannels.map((channel) => (
          <ChannelRow key={channel.id} channel={channel} active={false} onPress={() => {}} />
        ))}
      </ScrollView>
    </View>
  );
}

function ChannelRow({
  channel,
  active,
  onPress,
}: {
  channel: ChannelSummary;
  active: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  const unread = !active && channel.type === 'TEXT' && hasUnread(channel);
  const color = active || unread ? theme.fg : theme.muted;
  const Icon = channel.type === 'VOICE' ? Volume2 : Hash;
  return (
    <Pressable
      onPress={onPress}
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
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: '700' },
  list: { paddingHorizontal: 8, paddingBottom: 16 },
  section: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 6,
    marginLeft: 8,
  },
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
