import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { restoreSession, signIn, useSession } from '@/auth/session';
import { mc } from '@/ui/theme';

/** 로그인 화면 (웹 로그인 화면과 같은 팔레트) */
export default function LoginScreen() {
  const status = useSession((s) => s.status);
  const loginError = useSession((s) => s.loginError);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await signIn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.title}>MetaCode</Text>
        <Text style={styles.subtitle}>채팅과 메타버스를 한 화면에서</Text>
        {status === 'unavailable' ? (
          <>
            <Text style={styles.error}>서버에 연결하지 못했습니다.</Text>
            <Pressable style={styles.button} onPress={() => void restoreSession()}>
              <Text style={styles.buttonText}>다시 시도</Text>
            </Pressable>
          </>
        ) : (
          <>
            {loginError && <Text style={styles.error}>{loginError}</Text>}
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              onPress={() => void start()}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={mc.ink} />
              ) : (
                <Text style={styles.buttonText}>GitHub로 로그인</Text>
              )}
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: mc.night },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 44, gap: 12 },
  title: { color: mc.dawn, fontSize: 36, fontWeight: '700' },
  subtitle: { color: '#9aa3c0', fontSize: 16, marginBottom: 28 },
  error: { color: '#ff8a7a', fontSize: 14 },
  button: {
    alignSelf: 'flex-start',
    minWidth: 160,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 10,
    backgroundColor: mc.ember,
    borderBottomWidth: 3,
    borderBottomColor: '#c98f2c',
  },
  pressed: { transform: [{ translateY: 2 }], borderBottomWidth: 1 },
  buttonText: { color: mc.ink, fontSize: 15, fontWeight: '700' },
});
