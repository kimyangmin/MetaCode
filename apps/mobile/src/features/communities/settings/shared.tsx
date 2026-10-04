import { queryKeys } from '@metacode/client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../../../api/client';
import { useTheme } from '../../../ui/theme';

/** 요청 후 커뮤니티 정보(역할, 채널)와 멤버를 새로 받는다. 서버도 community:updated로 알린다 */
export function useRefresh(communityId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.communities });
    void queryClient.invalidateQueries({ queryKey: queryKeys.members(communityId) });
  };
}

/** 요청을 보내고 결과 글(성공·실패)을 들고 있는다 (웹 useRequest + 저장 결과) */
export function useRequest() {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (request: () => Promise<unknown>, fallback: string, ok?: string) => {
    setBusy(true);
    setStatus(null);
    try {
      await request();
      if (ok) setStatus({ ok: true, text: ok });
      return true;
    } catch (error) {
      setStatus({
        ok: false,
        text:
          error instanceof ApiError || error instanceof Error
            ? error.message || fallback
            : fallback,
      });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { status, busy, run };
}

export function StatusText({ status }: { status: { ok: boolean; text: string } | null }) {
  const theme = useTheme();
  if (!status) return null;
  return <Text style={{ color: status.ok ? theme.ok : theme.danger }}>{status.text}</Text>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.muted }]}>{label}</Text>
      {children}
    </View>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.hint, { color: theme.muted }]}>{children}</Text>;
}

/** 역할 색 고르기용 (웹은 색 입력칸. 휴대폰은 정해 둔 색에서 고른다) */
export const ROLE_COLORS = [
  '#99aab5',
  '#e74c3c',
  '#e67e22',
  '#f1c40f',
  '#2ecc71',
  '#1abc9c',
  '#3498db',
  '#9b59b6',
  '#e91e63',
  '#795548',
] as const;

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { fontSize: 12, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 17 },
});
