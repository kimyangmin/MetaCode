import { displayName } from '@metacode/client';
import { RTCView } from '@livekit/react-native-webrtc';
import { MicOff, X } from 'lucide-react-native';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVoiceStore } from './store';
import { useVoice } from './VoiceProvider';

/**
 * 화면 공유 보기 (웹 ScreenViewer의 휴대폰판): 화면 전체에 띄우고, 영상은 화면에 맞춰 줄인다.
 * 상태: 통화에 들어가는 중 → 불러오는 중 → 보는 중, 또는 실패(사유). 보려고 들어가면서 마이크를 껐으면 알린다.
 * WebRTC 네이티브 모듈을 쓰므로 보기를 열 때 불러온다 (lazy).
 */
export default function ScreenViewer() {
  const voice = useVoice();
  const insets = useSafeAreaInsets();
  const watching = useVoiceStore((s) => s.watching);
  const member = useVoiceStore((s) =>
    s.watching
      ? s.calls[s.watching.channelId]?.members.find((m) => m.user.id === s.watching!.userId)
      : undefined,
  );
  const muted = useVoiceStore((s) => s.muted);
  if (!watching) return null;

  const close = () => void voice.watch(null, null);
  const ended = !watching.joining && !watching.error && member && !member.sharing;
  const status = watching.error
    ? watching.error
    : watching.joining
      ? '통화에 들어가는 중…'
      : ended || !member
        ? '화면 공유가 끝났습니다.'
        : watching.streamUrl
          ? null
          : '화면을 불러오는 중…';

  return (
    <Modal visible animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        {watching.streamUrl && !status && (
          <RTCView streamURL={watching.streamUrl} objectFit="contain" style={styles.video} />
        )}
        {status && (
          <View style={styles.center}>
            {(watching.joining || (!watching.error && !ended && member)) && (
              <ActivityIndicator color="#fff" />
            )}
            <Text style={styles.status}>{status}</Text>
          </View>
        )}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Text style={styles.title} numberOfLines={1}>
            {member ? `${displayName(member.user)}의 화면` : '화면 공유'}
          </Text>
          <Pressable onPress={close} hitSlop={12} accessibilityLabel="닫기">
            <X color="#fff" size={24} />
          </Pressable>
        </View>
        {watching.mutedOnJoin && muted && (
          <Pressable
            onPress={() => void voice.toggleMute()}
            style={[styles.notice, { bottom: insets.bottom + 24 }]}
            accessibilityRole="button"
          >
            <MicOff color="#fff" size={16} />
            <Text style={styles.noticeText}>마이크를 끈 채로 들어왔어요 · 눌러서 켜기</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  video: { flex: 1 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 10 },
  status: { color: '#fff', fontSize: 15 },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  title: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '700' },
  notice: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(17,22,29,0.85)',
  },
  noticeText: { color: '#fff', fontSize: 14 },
});
