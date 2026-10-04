import { type EditorDoc, fromManifest, newDoc } from '@metacode/client';
import {
  type AssetDto,
  type AssetKind,
  type AssetManifest,
  PlazaStyle,
  characterStyle,
} from '@metacode/shared';
import { BUILTIN_ASSETS } from '@metacode/shared/builtin-assets';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { deleteAsset } from '../../api/assets';
import { ApiError } from '../../api/client';
import { openEditor } from '../../stores/editor';
import { AssetPreview } from '../../ui/AssetPreview';
import { useTheme } from '../../ui/theme';

const KIND_LABEL: Record<AssetKind, string> = {
  tile: '타일',
  object: '오브젝트',
  character: '캐릭터',
};

/** 새 문서 (웹 newEditorDoc과 같은 이름과 크기). 내장 에셋을 주면 그것을 복제한다 */
export function newEditorDoc(
  kind: AssetKind,
  builtin?: AssetManifest,
  style?: PlazaStyle,
): EditorDoc {
  if (builtin) return { ...fromManifest(builtin), name: `${builtin.name} 복사`.slice(0, 32) };
  if (kind === 'character') return newDoc('character', '새 캐릭터', undefined, style);
  if (kind === 'tile') return newDoc('tile', '새 타일');
  return newDoc('object', '새 오브젝트', { w: 1, h: 2 });
}

/**
 * 에셋 목록 (웹 AssetSettings·CommunityPlazaAssets): 누르면 도트 에디터로 고치고, 길게 누르면 지운다.
 * 새로 그리기(캐릭터는 광장 방식을 고름)와 내장 에셋 복제로 시작할 수 있다.
 */
export function AssetList({
  assets,
  kinds,
  communityId,
  emptyText,
}: {
  assets: AssetDto[];
  /** 새로 만들 수 있는 종류 */
  kinds: AssetKind[];
  communityId: string | null;
  emptyText: string;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [showBuiltins, setShowBuiltins] = useState(false);
  const builtins = Object.values(BUILTIN_ASSETS).filter((m) => kinds.includes(m.kind));

  const create = (kind: AssetKind) => {
    const open = (style?: PlazaStyle) =>
      openEditor({ mode: 'create', communityId, doc: newEditorDoc(kind, undefined, style) });
    if (kind !== 'character') {
      open();
      return;
    }
    Alert.alert(
      '새 캐릭터',
      '어느 광장에서 쓸 캐릭터인가요? (나중에 에디터의 캐릭터 설정에서 바꿀 수 있음)',
      [
        { text: '취소', style: 'cancel' },
        { text: '횡스크롤용', onPress: () => open(PlazaStyle.SideScroll) },
        { text: '탑다운용', onPress: () => open(PlazaStyle.TopDown) },
      ],
    );
  };

  const remove = (asset: AssetDto) =>
    Alert.alert(`"${asset.name}" 지우기`, '지운 에셋은 되돌릴 수 없습니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '지우기',
        style: 'destructive',
        onPress: () =>
          void deleteAsset(queryClient, asset).catch((e: unknown) =>
            Alert.alert('지우지 못했습니다', e instanceof ApiError ? e.message : undefined),
          ),
      },
    ]);

  return (
    <View style={styles.root}>
      <View style={styles.actions}>
        {kinds.map((kind) => (
          <Pressable
            key={kind}
            onPress={() => create(kind)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: pressed ? theme.bgHover : theme.bgActive },
            ]}
          >
            <Plus color={theme.fg} size={18} />
            <Text style={{ color: theme.fg, fontWeight: '600' }}>새 {KIND_LABEL[kind]}</Text>
          </Pressable>
        ))}
      </View>
      {assets.length === 0 ? (
        <Text style={{ color: theme.muted }}>{emptyText}</Text>
      ) : (
        <View style={styles.grid}>
          {assets.map((asset) => (
            <Card
              key={asset.id}
              manifest={asset.manifest}
              badge={
                asset.manifest.kind === 'character' &&
                characterStyle(asset.manifest) === PlazaStyle.SideScroll
                  ? '횡스크롤'
                  : asset.manifest.kind !== 'character'
                    ? KIND_LABEL[asset.manifest.kind]
                    : undefined
              }
              onPress={() => openEditor({ mode: 'edit', asset })}
              onLongPress={() => remove(asset)}
            />
          ))}
        </View>
      )}
      <Text style={{ color: theme.muted, fontSize: 12 }}>누르면 고치고, 길게 누르면 지웁니다.</Text>

      <Pressable onPress={() => setShowBuiltins((v) => !v)} accessibilityRole="button">
        <Text style={{ color: theme.accent, fontWeight: '600' }}>
          {showBuiltins ? '내장 에셋 접기' : '내장 에셋을 복제해서 시작하기'}
        </Text>
      </Pressable>
      {showBuiltins && (
        <View style={styles.grid}>
          {builtins.map((manifest) => (
            <Card
              key={manifest.name}
              manifest={manifest}
              onPress={() =>
                openEditor({
                  mode: 'create',
                  communityId,
                  doc: newEditorDoc(manifest.kind, manifest),
                })
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}

function Card({
  manifest,
  badge,
  onPress,
  onLongPress,
}: {
  manifest: AssetManifest;
  badge?: string;
  onPress(): void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={manifest.name}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? theme.bgHover : theme.bgSidebar, borderColor: theme.border },
      ]}
    >
      <AssetPreview
        manifest={manifest}
        box={56}
        animate={false}
        animation={manifest.kind === 'character' ? 'idle-down' : 'default'}
      />
      <Text style={{ color: theme.fg, fontSize: 12 }} numberOfLines={1}>
        {manifest.name}
      </Text>
      {badge && <Text style={{ color: theme.muted, fontSize: 10 }}>{badge}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: {
    width: 84,
    alignItems: 'center',
    gap: 4,
    padding: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
