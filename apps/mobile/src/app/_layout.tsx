import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { restoreSession, useSession } from '@/auth/session';
import { useTheme } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  const status = useSession((s) => s.status);
  const theme = useTheme();

  useEffect(() => {
    void restoreSession();
  }, []);

  // 로그인 상태를 알 때까지 시작 화면을 둔다 (로그인 화면이 잠깐 비치지 않게)
  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  const signedIn = status === 'signedIn';
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}
          >
            <Stack.Protected guard={signedIn}>
              <Stack.Screen name="(main)" />
            </Stack.Protected>
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="login" />
            </Stack.Protected>
            {/* 로그인 결과 딥링크 (metacode://auth). 받자마자 알맞은 화면으로 옮긴다 */}
            <Stack.Screen name="auth" />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
