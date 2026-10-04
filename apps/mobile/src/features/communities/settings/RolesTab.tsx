import { type CommunitySummary, MAX_ROLES, type RoleDto } from '@metacode/shared';
import { ChevronDown, ChevronUp, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { apiSend } from '../../../api/client';
import { Button } from '../../../ui/controls';
import { useTheme } from '../../../ui/theme';
import { Hint, ROLE_COLORS, StatusText, useRefresh, useRequest } from './shared';

/**
 * 역할 (웹 RolesTab): 만들기, 이름·색 바꾸기, 지우기, 순서(↑↓, 웹은 끌어서). 역할을 멤버에게 주면 비공개 채널을
 * 그 역할에게만 보여 줄 수 있고, 이름 색은 가진 역할 중 가장 위 역할의 색을 따른다.
 */
export function RolesTab({ community }: { community: CommunitySummary }) {
  const theme = useTheme();
  const refresh = useRefresh(community.id);
  const { status, busy, run } = useRequest();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(ROLE_COLORS[6]);
  const roles = community.roles;

  const create = async () => {
    const ok = await run(
      () => apiSend(`/communities/${community.id}/roles`, 'POST', { name: name.trim(), color }),
      '역할을 만들지 못했습니다.',
    );
    if (ok) {
      setName('');
      refresh();
    }
  };

  const move = (index: number, step: -1 | 1) => {
    const ids = roles.map((r) => r.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + step, 0, moved!);
    void run(
      () => apiSend(`/communities/${community.id}/roles/order`, 'PUT', { ids }),
      '순서를 바꾸지 못했습니다.',
    ).then(refresh);
  };

  return (
    <View style={styles.root}>
      <Hint>
        역할을 만들어 멤버에게 주면, 비공개 채널을 그 역할을 가진 멤버에게만 보여 줄 수 있습니다.
        이름 색은 가진 역할 중 가장 위 역할의 색을 따릅니다.
      </Hint>
      {roles.length === 0 && <Hint>아직 역할이 없습니다.</Hint>}
      {roles.map((role, i) => (
        <RoleRow
          key={role.id}
          communityId={community.id}
          role={role}
          first={i === 0}
          last={i === roles.length - 1}
          onMove={(step) => move(i, step)}
          run={run}
          onDone={refresh}
        />
      ))}

      <View style={[styles.create, { backgroundColor: theme.bgSidebar }]}>
        <ColorPicker value={color} onChange={setColor} />
        <View style={styles.row}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="새 역할 이름"
            placeholderTextColor={theme.muted}
            maxLength={30}
            style={[styles.input, { color: theme.fg, backgroundColor: theme.bgInput }]}
          />
          <Button
            label="만들기"
            variant="primary"
            busy={busy}
            disabled={!name.trim() || roles.length >= MAX_ROLES}
            onPress={() => void create()}
          />
        </View>
      </View>
      <StatusText status={status} />
    </View>
  );
}

function RoleRow({
  communityId,
  role,
  first,
  last,
  onMove,
  run,
  onDone,
}: {
  communityId: string;
  role: RoleDto;
  first: boolean;
  last: boolean;
  onMove(step: -1 | 1): void;
  run: ReturnType<typeof useRequest>['run'];
  onDone(): void;
}) {
  const theme = useTheme();
  const [name, setName] = useState(role.name);
  const [picking, setPicking] = useState(false);
  const url = `/communities/${communityId}/roles/${role.id}`;

  const update = async (patch: { name?: string; color?: string }) => {
    const ok = await run(() => apiSend(url, 'PATCH', patch), '역할을 바꾸지 못했습니다.');
    if (ok) onDone();
    else setName(role.name);
  };

  const remove = () =>
    Alert.alert(
      '역할 지우기',
      `"${role.name}" 역할을 지울까요? 이 역할로 보던 비공개 채널은 볼 수 없게 됩니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '지우기',
          style: 'destructive',
          onPress: () =>
            void run(() => apiSend(url, 'DELETE'), '역할을 지우지 못했습니다.').then(
              (ok) => ok && onDone(),
            ),
        },
      ],
    );

  return (
    <View style={[styles.role, { backgroundColor: theme.bgSidebar }]}>
      <View style={styles.row}>
        <Pressable
          onPress={() => setPicking((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`${role.name} 색 바꾸기`}
          hitSlop={6}
          style={[styles.dot, { backgroundColor: role.color ?? theme.muted }]}
        />
        <TextInput
          value={name}
          onChangeText={setName}
          onEndEditing={() =>
            name.trim() && name !== role.name && void update({ name: name.trim() })
          }
          maxLength={30}
          style={[styles.input, { color: theme.fg, backgroundColor: theme.bgInput }]}
          accessibilityLabel="역할 이름"
        />
        <IconButton icon={ChevronUp} label="위로" disabled={first} onPress={() => onMove(-1)} />
        <IconButton icon={ChevronDown} label="아래로" disabled={last} onPress={() => onMove(1)} />
        <IconButton icon={X} label={`${role.name} 지우기`} onPress={remove} />
      </View>
      {picking && (
        <ColorPicker
          value={role.color ?? ''}
          onChange={(color) => {
            setPicking(false);
            void update({ color });
          }}
        />
      )}
    </View>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange(color: string): void }) {
  const theme = useTheme();
  return (
    <View style={styles.colors}>
      {ROLE_COLORS.map((color) => (
        <Pressable
          key={color}
          onPress={() => onChange(color)}
          accessibilityRole="button"
          accessibilityLabel={`색 ${color}`}
          accessibilityState={{ selected: value === color }}
          hitSlop={3}
          style={[
            styles.swatch,
            { backgroundColor: color, borderColor: value === color ? theme.fg : 'transparent' },
          ]}
        />
      ))}
    </View>
  );
}

function IconButton({
  icon: Icon,
  label,
  disabled,
  onPress,
}: {
  icon: typeof X;
  label: string;
  disabled?: boolean;
  onPress(): void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.icon, { opacity: disabled ? 0.3 : 1 }]}
    >
      <Icon color={theme.muted} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  role: { borderRadius: 10, padding: 10, gap: 10 },
  create: { borderRadius: 10, padding: 10, gap: 10, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 26, height: 26, borderRadius: 13 },
  input: { flex: 1, minHeight: 40, borderRadius: 8, paddingHorizontal: 10, fontSize: 15 },
  icon: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 3 },
});
