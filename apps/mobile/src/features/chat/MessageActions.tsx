import { markdownToPlain } from '@metacode/client';
import type { MessageDto } from '@metacode/shared';
import * as Clipboard from 'expo-clipboard';
import { Copy, Forward, Pencil, Reply, Trash2 } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, ToastAndroid } from 'react-native';
import { Sheet } from '../../ui/Sheet';
import { useTheme } from '../../ui/theme';

interface Action {
  label: string;
  icon: ComponentType<{ color: string; size: number }>;
  danger?: boolean;
  run(message: MessageDto): void;
}

/** 메시지 길게 누르기 메뉴 (웹 우클릭 메뉴와 같은 항목) */
export function MessageActions({
  message,
  mine,
  canDelete,
  onClose,
  onReply,
  onForward,
  onEdit,
  onDelete,
}: {
  message: MessageDto | null;
  mine: boolean;
  canDelete: boolean;
  onClose(): void;
  onReply(message: MessageDto): void;
  onForward(message: MessageDto): void;
  onEdit(message: MessageDto): void;
  onDelete(message: MessageDto): void;
}) {
  const theme = useTheme();
  const actions: Action[] = [
    { label: '답장', icon: Reply, run: onReply },
    { label: '전달', icon: Forward, run: onForward },
    ...(message?.content
      ? [
          {
            label: '텍스트 복사',
            icon: Copy,
            run: (m: MessageDto) => {
              void Clipboard.setStringAsync(markdownToPlain(m.content));
              ToastAndroid.show('복사했습니다', ToastAndroid.SHORT);
            },
          },
        ]
      : []),
    ...(mine ? [{ label: '고치기', icon: Pencil, run: onEdit }] : []),
    ...(canDelete ? [{ label: '삭제', icon: Trash2, danger: true, run: onDelete }] : []),
  ];

  return (
    <Sheet visible={message !== null} title="메시지" onClose={onClose}>
      {actions.map((action) => {
        const color = action.danger ? theme.danger : theme.fg;
        const Icon = action.icon;
        return (
          <Pressable
            key={action.label}
            onPress={() => {
              const target = message;
              onClose();
              if (target) action.run(target);
            }}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.bgHover }]}
            accessibilityRole="button"
          >
            <Icon color={action.danger ? theme.danger : theme.muted} size={20} />
            <Text style={[styles.label, { color }]}>{action.label}</Text>
          </Pressable>
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 48,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  label: { fontSize: 16 },
});
