import {
  AVATAR_MAX_BYTES,
  type AvatarUploadTicket,
  BIO_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
  type UserDetail,
} from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiError, apiFetch, apiSend } from '../../api/client';
import { meQueryKey } from '../../api/queries';
import { Avatar } from '../../ui/Avatar';
import { Button, TextField } from '../../ui/controls';
import { useTheme } from '../../ui/theme';

/**
 * 설정 → 내 계정 (웹 AccountSettings): 프로필 사진(고를 때 시스템 화면에서 정사각형으로 자름), 사용자 ID 복사,
 * 닉네임, 자기소개.
 */
export function AccountSettings({ me }: { me: UserDetail }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [nickname, setNickname] = useState(me.displayName ?? '');
  const [bio, setBio] = useState(me.bio ?? '');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = nickname.trim() !== (me.displayName ?? '') || bio.trim() !== (me.bio ?? '');

  const run = async (action: () => Promise<UserDetail>, ok: string, fallback: string) => {
    setBusy(true);
    setStatus(null);
    try {
      queryClient.setQueryData(meQueryKey, await action());
      setStatus({ ok: true, text: ok });
      return true;
    } catch (error) {
      setStatus({
        ok: false,
        text: error instanceof ApiError || error instanceof Error ? error.message : fallback,
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const saved = await run(
      () =>
        apiSend<UserDetail>('/users/me', 'PATCH', { nickname: nickname.trim(), bio: bio.trim() }),
      '저장했습니다.',
      '저장하지 못했습니다.',
    );
    if (saved) {
      setNickname((v) => v.trim());
      setBio((v) => v.trim());
    }
  };

  const changePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets[0]!;
    const size = asset.fileSize ?? new File(asset.uri).size;
    if (size > AVATAR_MAX_BYTES) {
      setStatus({ ok: false, text: '15MB 이하의 사진만 올릴 수 있습니다.' });
      return;
    }
    await run(
      () => uploadAvatar(asset.uri, size),
      '프로필 사진을 바꿨습니다.',
      '사진을 올리지 못했습니다.',
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.photo}>
        <Avatar user={me} size={88} animate />
        <View style={styles.photoActions}>
          <Button
            label="사진 바꾸기"
            variant="primary"
            busy={busy}
            onPress={() => void changePhoto()}
          />
          {me.customAvatar && (
            <Button
              label="GitHub 사진으로 되돌리기"
              disabled={busy}
              onPress={() =>
                void run(
                  () => apiSend<UserDetail>('/users/me/avatar', 'DELETE'),
                  'GitHub 사진으로 되돌렸습니다.',
                  '사진을 되돌리지 못했습니다.',
                )
              }
            />
          )}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.muted }]}>사용자 ID</Text>
        <View style={styles.idRow}>
          <Text style={[styles.id, { color: theme.fg, backgroundColor: theme.bgInput }]}>
            @{me.username}
          </Text>
          <Button
            label="복사"
            onPress={() => {
              void Clipboard.setStringAsync(me.username);
              setStatus({ ok: true, text: '사용자 ID를 복사했습니다.' });
            }}
          />
        </View>
        <Text style={[styles.hint, { color: theme.muted }]}>
          GitHub 아이디로 정해지며 바꿀 수 없습니다. 다른 사람이 나를 찾을 때 이 ID를 씁니다.
        </Text>
      </View>

      <View style={styles.field}>
        <TextField
          label="닉네임"
          value={nickname}
          onChangeText={setNickname}
          placeholder={me.username}
          maxLength={NICKNAME_MAX_LENGTH}
        />
        <Text style={[styles.hint, { color: theme.muted }]}>
          다른 사람에게 보이는 이름입니다. 비워 두면 사용자 ID를 보여 줍니다.
        </Text>
      </View>

      <View style={styles.field}>
        <TextField
          label={`자기소개 ${bio.length}/${BIO_MAX_LENGTH}`}
          value={bio}
          onChangeText={setBio}
          maxLength={BIO_MAX_LENGTH}
          multiline
          placeholder="나를 소개해 보세요"
          style={styles.bio}
          textAlignVertical="top"
        />
      </View>

      {status && <Text style={{ color: status.ok ? theme.ok : theme.danger }}>{status.text}</Text>}
      <View style={styles.footer}>
        <View style={styles.footerButton}>
          <Button
            label="되돌리기"
            disabled={!dirty || busy}
            onPress={() => {
              setNickname(me.displayName ?? '');
              setBio(me.bio ?? '');
              setStatus(null);
            }}
          />
        </View>
        <View style={styles.footerButton}>
          <Button
            label="저장"
            variant="primary"
            disabled={!dirty || busy}
            onPress={() => void save()}
          />
        </View>
      </View>
    </View>
  );
}

/** 프로필 사진 올리기: 저장소에 바로 올리고, 서버가 확인해 256px 정사각형으로 바꾼다 (이미 정사각형으로 잘라 옴) */
async function uploadAvatar(uri: string, size: number): Promise<UserDetail> {
  const ticket = await apiSend<AvatarUploadTicket>('/users/me/avatar/upload', 'POST', { size });
  const result = await new File(uri)
    .createUploadTask(ticket.uploadUrl, { httpMethod: 'PUT', headers: ticket.headers })
    .uploadAsync();
  if (result.status < 200 || result.status >= 300) throw new Error('사진을 올리지 못했습니다.');
  return apiFetch<UserDetail>('/users/me/avatar', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

const styles = StyleSheet.create({
  root: { gap: 20 },
  photo: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  photoActions: { flex: 1, gap: 8 },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700' },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  id: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'monospace',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 8,
  },
  hint: { fontSize: 12 },
  bio: { minHeight: 96, paddingTop: 10 },
  footer: { flexDirection: 'row', gap: 8 },
  footerButton: { flex: 1 },
});
