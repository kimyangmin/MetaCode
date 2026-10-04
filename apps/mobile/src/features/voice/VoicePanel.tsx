import { dmTitle } from '@metacode/client';
import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Radar, X } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCommunities, useDms } from '../../api/queries';
import { useTheme } from '../../ui/theme';
import { useVoiceStore } from './store';
import { useVoice } from './VoiceProvider';

/** 통화 중인 채널의 이름 (음성 채널 이름, DM 상대) */
export function useCallTitle(channelId: string | null, meId: string): string {
  const communities = useCommunities().data;
  const dms = useDms().data;
  if (!channelId) return '';
  for (const community of communities ?? []) {
    const channel = community.channels.find((c) => c.id === channelId);
    if (channel) return `${channel.name ?? ''} · ${community.name}`;
  }
  const dm = dms?.find((d) => d.id === channelId);
  return dm ? dmTitle(dm, meId) : '';
}

const STATUS = {
  connecting: '연결 중…',
  connected: '통화 중',
  reconnecting: '다시 연결하는 중…',
} as const;

/**
 * 목록 서랍 아래의 음성 패널 (웹 VoicePanel): 통화 상태와 채널, 마이크·헤드셋·근접 음성·나가기.
 * 통화에 들어가지 못했으면 사유를 보여 준다.
 */
export function VoicePanel({ meId }: { meId: string }) {
  const theme = useTheme();
  const voice = useVoice();
  const session = useVoiceStore((s) => s.session);
  const muted = useVoiceStore((s) => s.muted);
  const deafened = useVoiceStore((s) => s.deafened);
  const error = useVoiceStore((s) => s.error);
  const proximity = useVoiceStore((s) =>
    s.session ? (s.calls[s.session.channelId]?.proximity ?? false) : false,
  );
  const title = useCallTitle(session?.channelId ?? null, meId);

  if (!session) {
    if (!error) return null;
    return (
      <View style={[styles.root, { backgroundColor: theme.bgRail, borderTopColor: theme.border }]}>
        <Text style={[styles.error, { color: theme.danger }]} numberOfLines={2}>
          {error}
        </Text>
        <Pressable
          onPress={() => useVoiceStore.getState().patch({ error: null })}
          hitSlop={8}
          accessibilityLabel="닫기"
        >
          <X color={theme.muted} size={18} />
        </Pressable>
      </View>
    );
  }

  const micOff = muted || deafened || session.listenOnly;
  return (
    <View style={[styles.panel, { backgroundColor: theme.bgRail, borderTopColor: theme.border }]}>
      <View style={styles.info}>
        <Text
          style={[styles.status, { color: session.status === 'connected' ? theme.ok : theme.warn }]}
        >
          {STATUS[session.status]}
          {session.listenOnly ? ' · 듣기만' : ''}
        </Text>
        <Text style={[styles.title, { color: theme.muted }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View style={styles.buttons}>
        <PanelButton
          icon={micOff ? MicOff : Mic}
          label={micOff ? '마이크 켜기' : '마이크 끄기'}
          active={micOff}
          onPress={() => void voice.toggleMute()}
        />
        <PanelButton
          icon={deafened ? HeadphoneOff : Headphones}
          label={deafened ? '헤드셋 켜기' : '헤드셋 끄기'}
          active={deafened}
          onPress={() => void voice.toggleDeafen()}
        />
        <PanelButton
          icon={Radar}
          label={proximity ? '근접 음성 끄기' : '근접 음성 켜기'}
          selected={proximity}
          onPress={() => void voice.setProximity(!proximity)}
        />
        <PanelButton icon={PhoneOff} label="나가기" danger onPress={() => voice.leave()} />
      </View>
    </View>
  );
}

function PanelButton({
  icon: Icon,
  label,
  active,
  selected,
  danger,
  onPress,
}: {
  icon: ComponentType<{ color: string; size: number }>;
  label: string;
  /** 꺼진 상태 (빨간색) */
  active?: boolean;
  /** 켜진 기능 (accent색) */
  selected?: boolean;
  danger?: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  const color = active || danger ? theme.danger : selected ? theme.accent : theme.fg;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.button, pressed && { backgroundColor: theme.bgHover }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected !== undefined ? { selected } : undefined}
    >
      <Icon color={color} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  panel: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  info: { gap: 2 },
  status: { fontSize: 13, fontWeight: '700' },
  title: { fontSize: 12 },
  error: { flex: 1, fontSize: 13 },
  buttons: { flexDirection: 'row', justifyContent: 'space-between' },
  button: {
    width: 48,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
