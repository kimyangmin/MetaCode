import { displayName, useIsOnline } from '@metacode/client';
import type { UserProfile } from '@metacode/shared';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from './theme';

/**
 * 프로필 사진. 못 불러오면 이름 첫 글자를 보여 준다 (웹 ui/Avatar.tsx와 같음).
 * expo-image가 연결이 돌아오면 다시 받으므로 웹처럼 주소를 바꿔 다시 시도하지 않는다.
 */
export function Avatar({
  user,
  size = 32,
  animate = false,
  showPresence = false,
  ringColor,
}: {
  user: Pick<UserProfile, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'avatarAnimatedUrl'>;
  size?: number;
  /** 움직이는 사진(GIF로 올린 것)이면 움직이게 (멤버 목록, 정보 팝업) */
  animate?: boolean;
  /** 오른쪽 아래에 온라인 점 */
  showPresence?: boolean;
  /** 말하는 중 등 테두리 색 */
  ringColor?: string;
}) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const online = useIsOnline(user.id);
  const uri = (animate && user.avatarAnimatedUrl) || user.avatarUrl;
  const dot = Math.max(8, Math.round(size * 0.3));

  return (
    <View style={{ width: size, height: size }}>
      {failed || !uri ? (
        <View
          style={[
            styles.fallback,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.bgActive },
          ]}
        >
          <Text style={{ color: theme.fg, fontSize: size * 0.42, fontWeight: '600' }}>
            {[...displayName(user)][0] ?? '?'}
          </Text>
        </View>
      ) : (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          onError={() => setFailed(true)}
          cachePolicy="memory-disk"
          transition={100}
        />
      )}
      {ringColor && (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: size / 2, borderWidth: 2, borderColor: ringColor },
          ]}
        />
      )}
      {showPresence && (
        <View
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            borderWidth: 2,
            borderColor: theme.bgSidebar,
            backgroundColor: online ? theme.ok : theme.muted,
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
