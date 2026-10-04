import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/ui/theme';
import { type ReleaseInfo, newerRelease } from './appVersion';

const RELEASES_URL = 'https://api.github.com/repos/kimyangmin/MetaCode/releases?per_page=30';

/**
 * 새 APK 안내. 안드로이드 앱은 스스로 업데이트하지 않으므로(GitHub Releases에서 받아 덮어 설치), 앱을 켤 때 저장소의
 * Release 목록에서 지금보다 새 `android-v*`가 있는지 보고 화면 위에 알린다. 누르면 그 Release 페이지를 연다.
 * GitHub API는 로그인 없이 IP마다 시간당 60번이라 6시간에 한 번만 본다. 실패하면 아무것도 띄우지 않는다.
 */
export function UpdateNotice() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const current = Constants.expoConfig?.version ?? '0.0.0';
  const [dismissed, setDismissed] = useState<string | null>(null);
  const update = useQuery({
    queryKey: ['app-update', current],
    queryFn: async () => {
      const res = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`releases ${res.status}`);
      return newerRelease((await res.json()) as ReleaseInfo[], current);
    },
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });
  const next = update.data;
  if (!next || dismissed === next.version) return null;
  return (
    <View
      style={[
        styles.notice,
        { top: insets.top + 8, backgroundColor: theme.bgSidebar, borderColor: theme.border },
      ]}
      accessibilityRole="alert"
    >
      <Text style={[styles.text, { color: theme.fg }]}>
        새 버전({next.version})이 나왔습니다. 받아서 덮어 설치해 주세요.
      </Text>
      <Pressable
        onPress={() => void Linking.openURL(next.url)}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.get,
          { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={[styles.getLabel, { color: theme.accentFg }]}>받기</Text>
      </Pressable>
      <Pressable
        onPress={() => setDismissed(next.version)}
        accessibilityRole="button"
        accessibilityLabel="닫기"
        hitSlop={8}
      >
        <X size={18} color={theme.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
  },
  text: { flex: 1, fontSize: 14 },
  get: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  getLabel: { fontSize: 14, fontWeight: '600' },
});
