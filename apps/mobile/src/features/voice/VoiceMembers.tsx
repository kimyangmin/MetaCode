import { displayName } from '@metacode/client';
import type { VoiceMember } from '@metacode/shared';
import { HeadphoneOff, MicOff } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../ui/Avatar';
import { useTheme } from '../../ui/theme';
import { useVoiceStore } from './store';
import { useVoice } from './VoiceProvider';

/** 말하는 중 테두리 색 (웹 --speaking) */
export const SPEAKING_COLOR = '#3fb950';

/**
 * 통화 참여자 목록 (웹 VoiceMembers). 말하는 사람은 아바타 테두리로 강조하고, 음소거·헤드셋 끔을 표시한다.
 * 말하는 중은 내가 그 통화에 들어가 있을 때만 보인다. 화면을 공유 중이면 LIVE를 눌러 본다.
 */
export function VoiceMembers({
  channelId,
  members,
}: {
  channelId: string;
  members: VoiceMember[];
}) {
  const theme = useTheme();
  const voice = useVoice();
  const inCall = useVoiceStore((s) => s.session?.channelId === channelId);
  if (members.length === 0) return null;
  return (
    <View style={styles.list} accessibilityLabel="통화 참여자">
      {members.map((member) => {
        const speaking = inCall && member.speaking && !member.muted;
        return (
          <View key={member.user.id} style={styles.row}>
            <Avatar
              user={member.user}
              size={24}
              ringColor={speaking ? SPEAKING_COLOR : undefined}
            />
            <Text style={[styles.name, { color: theme.muted }]} numberOfLines={1}>
              {displayName(member.user)}
            </Text>
            {member.sharing && (
              <Pressable
                onPress={() => void voice.watch(channelId, member.user.id)}
                hitSlop={8}
                style={[styles.live, { backgroundColor: theme.danger }]}
                accessibilityRole="button"
                accessibilityLabel={`${displayName(member.user)}의 화면 보기`}
              >
                <Text style={styles.liveText}>LIVE</Text>
              </Pressable>
            )}
            {member.deafened ? (
              <HeadphoneOff color={theme.muted} size={14} accessibilityLabel="헤드셋 꺼짐" />
            ) : (
              member.muted && (
                <MicOff color={theme.muted} size={14} accessibilityLabel="마이크 꺼짐" />
              )
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingLeft: 30, paddingBottom: 4, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  name: { flex: 1, fontSize: 14 },
  live: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  liveText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
