import { queryKeys } from '@metacode/client';
import {
  AVATAR_MAX_BYTES,
  type AvatarUploadTicket,
  COMMUNITY_IMAGE_SIZE,
  type CommunityImageKind,
  CommunityRole,
  type CommunitySummary,
  PlazaStyle,
} from '@metacode/shared';
import { useQueryClient } from '@tanstack/react-query';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useCommunityAssets } from '../../../api/assets';
import { apiSend } from '../../../api/client';
import { AssetList } from '../../editor/AssetList';
import { openMapEditor } from '../../../stores/editor';
import { Button, Segmented, TextField } from '../../../ui/controls';
import { useTheme } from '../../../ui/theme';
import { Field, Hint, StatusText, useRefresh, useRequest } from './shared';

const IMAGE_LABEL: Record<CommunityImageKind, string> = { icon: '아이콘', banner: '배너' };
const IMAGE_OBJECT: Record<CommunityImageKind, string> = { icon: '아이콘을', banner: '배너를' };

/** 아이콘·배너 올리기: 시스템 화면에서 그 비율로 잘라 오고, 저장소에 올린 뒤 서버가 확인해 적용한다 */
async function uploadImage(
  communityId: string,
  kind: CommunityImageKind,
  uri: string,
  size: number,
) {
  const base = `/communities/${communityId}/images/${kind}`;
  const ticket = await apiSend<AvatarUploadTicket>(`${base}/upload`, 'POST', { size });
  const result = await new File(uri)
    .createUploadTask(ticket.uploadUrl, { httpMethod: 'PUT', headers: ticket.headers })
    .uploadAsync();
  if (result.status < 200 || result.status >= 300) throw new Error('이미지를 올리지 못했습니다.');
  await apiSend(base, 'PUT', {});
}

/** 일반: 이름, 아이콘, 배너, 커뮤니티 삭제(소유자만, 이름을 그대로 입력) */
export function GeneralTab({ community }: { community: CommunitySummary }) {
  const theme = useTheme();
  const refresh = useRefresh(community.id);
  const { status, busy, run } = useRequest();
  const [name, setName] = useState(community.name);
  const trimmed = name.trim();

  const act = async (request: () => Promise<unknown>, fallback: string, ok: string) => {
    if (await run(request, fallback, ok)) refresh();
  };

  const pick = async (kind: CommunityImageKind) => {
    const { width, height } = COMMUNITY_IMAGE_SIZE[kind];
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [width, height],
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets[0]!;
    const size = asset.fileSize ?? new File(asset.uri).size;
    if (size > AVATAR_MAX_BYTES) {
      Alert.alert('15MB 이하의 이미지만 올릴 수 있습니다.');
      return;
    }
    await act(
      () => uploadImage(community.id, kind, asset.uri, size),
      `${IMAGE_OBJECT[kind]} 올리지 못했습니다.`,
      `${IMAGE_OBJECT[kind]} 바꿨습니다.`,
    );
  };

  return (
    <View style={styles.root}>
      <Field label="이름">
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField value={name} onChangeText={setName} maxLength={50} />
          </View>
          <Button
            label="저장"
            variant="primary"
            disabled={busy || !trimmed || trimmed === community.name}
            onPress={() =>
              void act(
                () => apiSend(`/communities/${community.id}`, 'PATCH', { name: trimmed }),
                '이름을 바꾸지 못했습니다.',
                '이름을 바꿨습니다.',
              )
            }
          />
        </View>
      </Field>

      {(['icon', 'banner'] as const).map((kind) => {
        const url = kind === 'icon' ? community.iconUrl : community.bannerUrl;
        const { width, height } = COMMUNITY_IMAGE_SIZE[kind];
        return (
          <Field key={kind} label={IMAGE_LABEL[kind]}>
            <View style={styles.imageRow}>
              <View
                style={[
                  kind === 'icon' ? styles.icon : styles.banner,
                  { backgroundColor: theme.bgActive },
                ]}
              >
                {url ? (
                  <Image source={{ uri: url }} style={StyleSheet.absoluteFill} />
                ) : (
                  <Text style={{ color: theme.muted, fontSize: 12 }}>
                    {kind === 'icon' ? community.name.slice(0, 2) : '배너 없음'}
                  </Text>
                )}
              </View>
              <View style={styles.flex}>
                <Button
                  label={url ? '바꾸기' : '올리기'}
                  disabled={busy}
                  onPress={() => void pick(kind)}
                />
                {url && (
                  <Button
                    label="지우기"
                    disabled={busy}
                    onPress={() =>
                      void act(
                        () => apiSend(`/communities/${community.id}/images/${kind}`, 'DELETE'),
                        `${IMAGE_OBJECT[kind]} 지우지 못했습니다.`,
                        `${IMAGE_OBJECT[kind]} 지웠습니다.`,
                      )
                    }
                  />
                )}
              </View>
            </View>
            <Hint>
              {kind === 'icon'
                ? '왼쪽 커뮤니티 목록과 초대 화면에 보입니다.'
                : '채널 목록 위에 보입니다.'}{' '}
              {width}×{height}로 씁니다 · 15MB 이하
            </Hint>
          </Field>
        );
      })}

      <StatusText status={status} />
      {community.myRole === CommunityRole.Owner && <DeleteCommunity community={community} />}
    </View>
  );
}

/** 커뮤니티 삭제 (소유자만). 실수로 지우지 않게 이름을 그대로 입력해야 한다 */
function DeleteCommunity({ community }: { community: CommunitySummary }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { status, busy, run } = useRequest();
  const [confirm, setConfirm] = useState('');
  const remove = async () => {
    const ok = await run(
      () => apiSend(`/communities/${community.id}`, 'DELETE'),
      '커뮤니티를 삭제하지 못했습니다.',
    );
    if (!ok) return;
    queryClient.setQueryData<CommunitySummary[]>(queryKeys.communities, (list) =>
      list?.filter((c) => c.id !== community.id),
    );
    router.replace('/');
  };
  return (
    <View style={[styles.danger, { borderColor: theme.danger }]}>
      <Text style={[styles.dangerTitle, { color: theme.danger }]}>커뮤니티 삭제</Text>
      <Hint>
        모든 채널, 메시지, 첨부 파일, 광장 에셋과 맵이 지워지고 되돌릴 수 없습니다. 확인하려면
        커뮤니티 이름 "{community.name}"을(를) 입력하세요.
      </Hint>
      <TextField
        label=""
        value={confirm}
        onChangeText={setConfirm}
        placeholder={community.name}
        autoCapitalize="none"
      />
      <Button
        label="커뮤니티 삭제"
        variant="danger"
        busy={busy}
        disabled={confirm !== community.name}
        onPress={() => void remove()}
      />
      <StatusText status={status} />
    </View>
  );
}

const STYLE_TO: Record<PlazaStyle, string> = {
  [PlazaStyle.TopDown]: '탑다운으로',
  [PlazaStyle.SideScroll]: '횡스크롤로',
};

/**
 * 광장: 광장 방식 바꾸기, 맵 편집, 커뮤니티 타일·오브젝트. 방식을 바꾸면 광장을 보던 사람들은 새 광장의 스폰 영역에서
 * 다시 시작한다. 맵 에디터로 꾸민 맵은 그 방식에서만 쓰고 지우지 않는다.
 */
export function PlazaTab({ community }: { community: CommunitySummary }) {
  const refresh = useRefresh(community.id);
  const { status, busy, run } = useRequest();
  const [style, setStyle] = useState<PlazaStyle>(community.plazaStyle);
  // 다른 관리자가 바꿨으면 따라간다
  const [shown, setShown] = useState(community.plazaStyle);
  if (shown !== community.plazaStyle) {
    setShown(community.plazaStyle);
    setStyle(community.plazaStyle);
  }

  const apply = () =>
    Alert.alert(
      `광장을 ${STYLE_TO[style]} 바꿀까요?`,
      '광장을 보고 있는 사람들은 새 광장의 스폰 영역에서 다시 시작합니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '바꾸기',
          onPress: () =>
            void run(
              () => apiSend(`/communities/${community.id}`, 'PATCH', { plazaStyle: style }),
              '광장 방식을 바꾸지 못했습니다.',
              `광장을 ${STYLE_TO[style]} 바꿨습니다.`,
            ).then((ok) => ok && refresh()),
        },
      ],
    );

  return (
    <View style={styles.root}>
      <Field label="광장 방식">
        <Segmented<PlazaStyle>
          value={style}
          onChange={setStyle}
          options={[
            { value: PlazaStyle.TopDown, label: '탑다운' },
            { value: PlazaStyle.SideScroll, label: '횡스크롤' },
          ]}
        />
        <Hint>
          {style === PlazaStyle.TopDown
            ? '위에서 내려다본 분수 광장. 아무 방향으로나 걷습니다.'
            : '옆에서 본 분수 광장. 좌우로 걷고 점프해 발판에 오릅니다.'}
        </Hint>
      </Field>
      <Button
        label="광장 방식 바꾸기"
        variant="primary"
        busy={busy}
        disabled={style === community.plazaStyle}
        onPress={apply}
      />
      <StatusText status={status} />
      <Hint>
        맵 에디터로 꾸민 맵은 그 방식에서만 쓰고 지우지 않습니다. 원래 방식으로 되돌리면 다시
        나타납니다.
      </Hint>
      <Field label="광장 맵">
        <Hint>
          지금 광장 방식({community.plazaStyle === PlazaStyle.SideScroll ? '횡스크롤' : '탑다운'})의
          맵에 타일을 칠하고 오브젝트를 놓습니다. 저장하면 광장에 있던 사람들은 스폰 영역에서 다시
          시작합니다.
        </Hint>
        <Button
          label="광장 맵 편집"
          onPress={() =>
            openMapEditor({ communityId: community.id, communityName: community.name })
          }
        />
      </Field>
      <CommunityAssets communityId={community.id} />
    </View>
  );
}

/** 커뮤니티 타일·오브젝트 (이 커뮤니티 광장의 맵에 쓴다) */
function CommunityAssets({ communityId }: { communityId: string }) {
  const theme = useTheme();
  const assets = useCommunityAssets(communityId).data ?? [];
  return (
    <Field label="커뮤니티 타일·오브젝트">
      <Text style={{ color: theme.muted, fontSize: 12 }}>
        이 커뮤니티 광장의 맵에 놓을 수 있습니다. 맵에 쓰고 있는 에셋은 지울 수 없습니다.
      </Text>
      <AssetList
        assets={assets}
        kinds={['tile', 'object']}
        communityId={communityId}
        emptyText="아직 커뮤니티 에셋이 없습니다."
      />
    </Field>
  );
}

const styles = StyleSheet.create({
  root: { gap: 20 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  flex: { flex: 1, gap: 8 },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    width: 128,
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  danger: { gap: 10, borderWidth: 1, borderRadius: 12, padding: 14 },
  dangerTitle: { fontSize: 15, fontWeight: '700' },
});
