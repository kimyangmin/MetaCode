import type { UserProfile } from '@metacode/shared';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch } from '@/api/client';
import { signOut } from '@/auth/session';
import { useTheme } from '@/ui/theme';

/** 임시 첫 화면: 로그인한 사용자 확인 (다음 단계에서 커뮤니티·채팅 화면으로 바뀐다) */
export default function Home() {
  const theme = useTheme();
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch<UserProfile>('/users/me') });

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]}>
      <View style={styles.body}>
        {me.data ? (
          <>
            <Image source={{ uri: me.data.avatarUrl ?? undefined }} style={styles.avatar} />
            <Text style={[styles.name, { color: theme.fg }]}>{me.data.displayName}</Text>
            <Text style={{ color: theme.muted }}>@{me.data.username}</Text>
          </>
        ) : (
          <Text style={{ color: theme.muted }}>{me.error ? me.error.message : '불러오는 중…'}</Text>
        )}
        <Pressable
          style={[styles.button, { borderColor: theme.border }]}
          onPress={() => void signOut()}
        >
          <Text style={{ color: theme.danger }}>로그아웃</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  name: { fontSize: 20, fontWeight: '700', marginTop: 8 },
  button: {
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
  },
});
