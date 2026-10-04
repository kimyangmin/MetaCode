import { queryKeys } from '@metacode/client';
import type { ChannelSummary, ChannelType, CommunitySummary, RoleDto } from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ApiError, apiSend } from '../../api/client';
import { Button, Segmented, TextField } from '../../ui/controls';
import { Sheet } from '../../ui/Sheet';
import { useTheme } from '../../ui/theme';

/** 비공개 채널 칸 (웹 ChannelAccessFields): 켜면 소유자·관리자와 고른 역할을 가진 멤버만 본다 */
export function ChannelAccessFields({
  roles,
  isPrivate,
  roleIds,
  onChange,
}: {
  roles: RoleDto[];
  isPrivate: boolean;
  roleIds: string[];
  onChange(next: { isPrivate: boolean; roleIds: string[] }): void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.access}>
      <View style={styles.switchRow}>
        <Lock color={theme.muted} size={18} />
        <Text style={[styles.switchLabel, { color: theme.fg }]}>비공개 채널</Text>
        <Switch
          value={isPrivate}
          onValueChange={(value) => onChange({ isPrivate: value, roleIds })}
        />
      </View>
      {isPrivate && (
        <>
          <Text style={[styles.hint, { color: theme.muted }]}>
            소유자와 관리자, 아래에서 고른 역할을 가진 멤버만 이 채널을 봅니다. 광장 말풍선도 볼 수
            있는 사람에게만 뜹니다.
          </Text>
          {roles.length === 0 ? (
            <Text style={[styles.hint, { color: theme.muted }]}>
              아직 역할이 없습니다. 커뮤니티 설정 → 역할에서 만들 수 있습니다.
            </Text>
          ) : (
            <RoleChips
              roles={roles}
              selected={roleIds}
              onToggle={(id) =>
                onChange({
                  isPrivate,
                  roleIds: roleIds.includes(id)
                    ? roleIds.filter((r) => r !== id)
                    : [...roleIds, id],
                })
              }
            />
          )}
        </>
      )}
    </View>
  );
}

/** 역할 고르기 칩 (멤버 역할 주기, 비공개 채널) */
export function RoleChips({
  roles,
  selected,
  onToggle,
}: {
  roles: RoleDto[];
  selected: string[];
  onToggle(id: string): void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.chips}>
      {roles.map((role) => {
        const on = selected.includes(role.id);
        const color = role.color ?? theme.muted;
        return (
          <Pressable
            key={role.id}
            onPress={() => onToggle(role.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            style={[
              styles.chip,
              {
                borderColor: on ? color : theme.border,
                backgroundColor: on ? theme.bgActive : 'transparent',
              },
            ]}
          >
            <View style={[styles.chipDot, { backgroundColor: color }]} />
            <Text style={{ color: theme.fg, fontSize: 13 }}>{role.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function updateCommunity(
  list: CommunitySummary[] | undefined,
  communityId: string,
  change: (c: CommunitySummary) => CommunitySummary,
) {
  return list?.map((c) => (c.id === communityId ? change(c) : c));
}

/**
 * 채널 만들기·설정 (웹 CreateChannelDialog, ChannelSettings): 종류(만들 때만), 이름, 비공개·역할, 삭제(설정할 때).
 * channel이 있으면 그 채널의 설정, 없으면 initialType 구역에 새 채널.
 */
export function ChannelEditor({
  community,
  channel,
  initialType,
  onClose,
}: {
  community: CommunitySummary;
  channel?: ChannelSummary;
  initialType?: ChannelType;
  onClose(): void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [type, setType] = useState<ChannelType>(channel?.type ?? initialType ?? 'TEXT');
  const [name, setName] = useState(channel?.name ?? '');
  const [access, setAccess] = useState({
    isPrivate: channel?.private ?? false,
    roleIds: channel?.roleIds ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (request: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await request();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    void run(
      async () => {
        const body = { name: name.trim(), private: access.isPrivate, roleIds: access.roleIds };
        if (channel) {
          await apiSend(`/channels/${channel.id}`, 'PATCH', body);
          void queryClient.invalidateQueries({ queryKey: queryKeys.communities });
          return;
        }
        const created = await apiSend<ChannelSummary>(
          `/communities/${community.id}/channels`,
          'POST',
          {
            ...body,
            type,
          },
        );
        queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
          updateCommunity(list, community.id, (c) =>
            c.channels.some((ch) => ch.id === created.id)
              ? c
              : { ...c, channels: [...c.channels, created] },
          ),
        );
        // 음성 채널은 만들어도 보던 텍스트 채널에 그대로 있는다 (웹과 같음)
        if (created.type === 'TEXT') router.replace(`/c/${community.id}/${created.id}`);
      },
      channel ? '채널 설정을 바꾸지 못했습니다.' : '채널을 만들지 못했습니다.',
    );

  const remove = () => {
    if (!channel) return;
    const kind = channel.type === 'VOICE' ? '음성 채널' : '채널';
    Alert.alert(
      `${kind} 삭제`,
      `"${channel.name}" ${kind}을 삭제할까요? 메시지와 첨부 파일이 모두 지워집니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              await apiSend(`/channels/${channel.id}`, 'DELETE');
              queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
                updateCommunity(list, community.id, (c) => ({
                  ...c,
                  channels: c.channels.filter((ch) => ch.id !== channel.id),
                })),
              );
              router.replace(`/c/${community.id}`);
            }, '채널을 삭제하지 못했습니다.'),
        },
      ],
    );
  };

  return (
    <Sheet visible title={channel ? '채널 설정' : '채널 만들기'} onClose={onClose}>
      {!channel && (
        <Segmented<ChannelType>
          value={type}
          onChange={setType}
          options={[
            { value: 'TEXT', label: '텍스트 채널' },
            { value: 'VOICE', label: '음성 채널' },
          ]}
        />
      )}
      <TextField
        label="채널 이름"
        value={name}
        onChangeText={setName}
        maxLength={30}
        autoFocus={!channel}
        placeholder={type === 'VOICE' ? '예: 수다방' : '예: 공지'}
      />
      <ChannelAccessFields
        roles={community.roles}
        isPrivate={access.isPrivate}
        roleIds={access.roleIds}
        onChange={setAccess}
      />
      {error && <Text style={{ color: theme.danger }}>{error}</Text>}
      <View style={styles.actions}>
        {channel && (
          <View style={styles.action}>
            <Button label="채널 삭제" variant="danger" disabled={busy} onPress={remove} />
          </View>
        )}
        <View style={styles.action}>
          <Button
            label={channel ? '저장' : '만들기'}
            variant="primary"
            busy={busy}
            disabled={!name.trim()}
            onPress={save}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  access: { gap: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchLabel: { flex: 1, fontSize: 15 },
  hint: { fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipDot: { width: 10, height: 10, borderRadius: 5 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
});
