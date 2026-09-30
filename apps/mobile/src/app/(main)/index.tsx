import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useCommunities } from '@/api/queries';
import { useTheme } from '@/ui/theme';

/** 첫 화면: 첫 번째 커뮤니티, 없으면 DM (웹 HomeRedirect와 같음) */
export default function HomeRedirect() {
  const theme = useTheme();
  const communities = useCommunities();
  if (!communities.data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.muted} />
      </View>
    );
  }
  const first = communities.data[0];
  return <Redirect href={first ? `/c/${first.id}` : '/dm'} />;
}
