import { Phone, PhoneOff } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../ui/theme';
import { useCall, useVoiceStore } from './store';
import { VoiceMembers } from './VoiceMembers';
import { useVoice } from './VoiceProvider';

/** DM 머리글의 통화 버튼 (웹 CallButton): 통화에 들어가거나 나간다 */
export function CallButton({ channelId }: { channelId: string }) {
  const theme = useTheme();
  const voice = useVoice();
  const inCall = useVoiceStore((s) => s.session?.channelId === channelId);
  return (
    <Pressable
      onPress={() => (inCall ? voice.leave() : void voice.join(channelId))}
      hitSlop={8}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={inCall ? '통화 나가기' : '통화 시작'}
    >
      {inCall ? (
        <PhoneOff color={theme.danger} size={22} />
      ) : (
        <Phone color={theme.muted} size={22} />
      )}
    </Pressable>
  );
}

/** DM에서 통화가 진행 중이면 머리글 아래에 참여자와 들어가기를 보여 준다 */
export function CallBar({ channelId }: { channelId: string }) {
  const theme = useTheme();
  const voice = useVoice();
  const call = useCall(channelId);
  const inCall = useVoiceStore((s) => s.session?.channelId === channelId);
  const members = call?.members ?? [];
  if (members.length === 0) return null;
  return (
    <View
      style={[styles.bar, { backgroundColor: theme.bgSidebar, borderBottomColor: theme.border }]}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: theme.ok }]}>{members.length}명 통화 중</Text>
        {!inCall && (
          <Pressable
            onPress={() => void voice.join(channelId)}
            style={[styles.join, { backgroundColor: theme.ok }]}
            accessibilityRole="button"
          >
            <Phone color="#fff" size={14} />
            <Text style={styles.joinText}>들어가기</Text>
          </Pressable>
        )}
      </View>
      <VoiceMembers channelId={channelId} members={members} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  bar: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 13, fontWeight: '700' },
  join: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  joinText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
