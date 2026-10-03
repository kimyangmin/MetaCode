import { dmTitle } from '@metacode/client';
import { type MessageDto, SocketEvent } from '@metacode/shared';
import { Hash, MessageCircle } from 'lucide-react-native';
import { Alert, Pressable, ScrollView, StyleSheet, Text, ToastAndroid } from 'react-native';
import { useCommunities, useDms, useMe } from '../../api/queries';
import { useRealtime } from '../../realtime/RealtimeProvider';
import { Sheet } from '../../ui/Sheet';
import { useTheme } from '../../ui/theme';

/** 메시지 전달 (웹 ForwardDialog): 쓸 수 있는 텍스트 채널·DM을 골라 `message:forward` */
export function ForwardSheet({
  message,
  onClose,
}: {
  message: MessageDto | null;
  onClose(): void;
}) {
  const theme = useTheme();
  const { socket } = useRealtime();
  const me = useMe().data;
  const communities = useCommunities().data ?? [];
  const dms = useDms().data ?? [];

  const forward = (channelId: string, name: string) => {
    if (!message || !socket) return;
    onClose();
    socket
      .timeout(10_000)
      .emit(SocketEvent.MessageForward, { messageId: message.id, channelId }, (err, result) => {
        if (err) {
          Alert.alert('전달하지 못했습니다', '서버가 응답하지 않습니다.');
          return;
        }
        if (!result.ok) {
          Alert.alert('전달하지 못했습니다', result.error);
          return;
        }
        ToastAndroid.show(`${name}에 전달했습니다`, ToastAndroid.SHORT);
      });
  };

  const rowStyle = ({ pressed }: { pressed: boolean }) => [
    styles.row,
    pressed && { backgroundColor: theme.bgHover },
  ];

  return (
    <Sheet visible={message !== null} title="전달하기" onClose={onClose}>
      <ScrollView style={styles.list}>
        {dms.map((dm) => {
          const name = me ? dmTitle(dm, me.id) : '';
          return (
            <Pressable key={dm.id} onPress={() => forward(dm.id, name)} style={rowStyle}>
              <MessageCircle color={theme.muted} size={18} />
              <Text style={[styles.name, { color: theme.fg }]} numberOfLines={1}>
                {name}
              </Text>
            </Pressable>
          );
        })}
        {communities.map((c) =>
          c.channels
            .filter((ch) => ch.type === 'TEXT')
            .map((ch) => (
              <Pressable key={ch.id} onPress={() => forward(ch.id, `#${ch.name}`)} style={rowStyle}>
                <Hash color={theme.muted} size={18} />
                <Text style={[styles.name, { color: theme.fg }]} numberOfLines={1}>
                  {ch.name}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 12 }} numberOfLines={1}>
                  {c.name}
                </Text>
              </Pressable>
            )),
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 420 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  name: { flex: 1, fontSize: 15 },
});
