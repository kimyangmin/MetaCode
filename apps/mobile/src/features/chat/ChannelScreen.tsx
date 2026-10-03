import type { VoiceLabel } from '@metacode/client';
import type { ChannelSummary, PlazaId, UserProfile } from '@metacode/shared';
import { Map as MapIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMe } from '../../api/queries';
import { ScreenHeader } from '../../layout/ScreenHeader';
import { useOtherUnread } from '../../layout/useOtherUnread';
import { useUiStore } from '../../stores/ui';
import { useTheme } from '../../ui/theme';
import { PlazaSplit } from '../plaza/PlazaSplit';
import { CallBar, CallButton } from '../voice/CallBar';
import { ChatView } from './ChatView';

/**
 * 채널 화면(텍스트 채널, DM): 머리글 + 광장(위) + 채팅(아래). 웹 휴대폰 화면처럼 위아래로만 나누고,
 * 머리글의 지도 버튼으로 광장을 켜고 끈다.
 */
export function ChannelScreen({
  channel,
  icon,
  title,
  inputTitle,
  people,
  showMembers,
  canDeleteOthers,
  plazaId,
  plazaChannels,
  plazaVoice,
  callable = false,
}: {
  channel: ChannelSummary;
  icon?: ReactNode;
  title: string;
  /** 입력칸 안내에 쓸 이름 (#일반, 상대 이름) */
  inputTitle: string;
  people: UserProfile[];
  showMembers: boolean;
  canDeleteOthers: boolean;
  /** 이 채널이 속한 광장 (커뮤니티 분수 광장, DM 모닥불 캠프) */
  plazaId: PlazaId;
  /** 광장에 말풍선을 띄울 채널과 그 이름표 */
  plazaChannels: ReadonlyMap<string, string | null>;
  /** 광장 캐릭터 위에 보일 통화 이름 (커뮤니티의 음성 채널들, DM은 그 DM) */
  plazaVoice: ReadonlyMap<string, VoiceLabel>;
  /** DM: 이 채널에서 바로 통화한다 (머리글 통화 버튼, 통화 중 표시) */
  callable?: boolean;
}) {
  const theme = useTheme();
  const me = useMe().data;
  const otherUnread = useOtherUnread(channel.id);
  const plazaOpen = useUiStore((s) => s.plazaOpen);
  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScreenHeader
        icon={icon}
        title={title}
        otherUnread={otherUnread}
        showMembers={showMembers}
        actions={
          <>
            {callable && <CallButton channelId={channel.id} />}
            <Pressable
              onPress={() => useUiStore.getState().setPlazaOpen(!plazaOpen)}
              hitSlop={8}
              style={styles.button}
              accessibilityRole="button"
              accessibilityLabel={plazaOpen ? '광장 닫기' : '광장 열기'}
              accessibilityState={{ selected: plazaOpen }}
            >
              <MapIcon color={plazaOpen ? theme.accent : theme.muted} size={22} />
            </Pressable>
          </>
        }
      />
      {callable && <CallBar channelId={channel.id} />}
      {me && (
        <PlazaSplit
          plaza={
            plazaOpen
              ? { plazaId, me, channelLabels: plazaChannels, voiceLabels: plazaVoice }
              : null
          }
        >
          <ChatView
            channelId={channel.id}
            title={inputTitle}
            me={me}
            lastReadMessageId={channel.lastReadMessageId}
            people={people}
            canDeleteOthers={canDeleteOthers}
          />
        </PlazaSplit>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  button: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
});
