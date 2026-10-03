import { dmTitle } from '@metacode/client';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useDms, useMe } from '@/api/queries';
import { ChannelScreen } from '@/features/chat/ChannelScreen';

/** DM, 그룹 DM */
export default function DmChannel() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const me = useMe().data;
  const dms = useDms();
  if (!dms.data || !me) return null;
  const dm = dms.data.find((d) => d.id === channelId);
  if (!dm) return <Redirect href="/dm" />;
  const title = dmTitle(dm, me.id);
  return (
    <ChannelScreen
      key={dm.id}
      channel={dm}
      title={title}
      inputTitle={title}
      people={dm.participants}
      showMembers={false}
      canDeleteOthers={false}
      plazaId={`dm:${dm.id}`}
      plazaChannels={new Map([[dm.id, null]])}
    />
  );
}
