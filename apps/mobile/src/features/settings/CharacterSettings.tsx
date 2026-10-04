import {
  type AssetManifest,
  BUILTIN_CHARACTERS,
  COLOR_PRESETS,
  COLOR_SLOTS,
  type CharacterChoice,
  type ColorSlot,
  PlazaStyle,
  type UserDetail,
  characterAnimation,
  characterFitsStyle,
  characterFor,
  characterKey,
  characterPalette,
  defaultCharacter,
} from '@metacode/shared';
import { builtinAsset } from '@metacode/shared/builtin-assets';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMyAssets } from '../../api/assets';
import { ApiError, apiSend } from '../../api/client';
import { meQueryKey } from '../../api/queries';
import { AssetPreview } from '../../ui/AssetPreview';
import { Button, Segmented } from '../../ui/controls';
import { useTheme } from '../../ui/theme';

const SLOT_LABEL: Record<ColorSlot, string> = {
  skin: '피부',
  hair: '머리',
  shirt: '윗옷',
  pants: '바지',
  shoes: '신발',
};

const DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
const SIDE_POSES = [
  { animation: 'idle-right', label: '대기' },
  { animation: 'walk-right', label: '걷기' },
  { animation: 'jump-right', label: '점프' },
  { animation: 'emote', label: '첨부 모션' },
] as const;

/**
 * 설정 → 캐릭터 (웹 CharacterSettings): 탑다운 광장과 횡스크롤 광장의 캐릭터를 따로 고른다. 기본 캐릭터는 부위마다
 * 색을 바꾸고, 직접 그린 캐릭터도 고를 수 있다 (그리기는 에디터 단계에서).
 */
export function CharacterSettings({ me }: { me: UserDetail }) {
  const [style, setStyle] = useState<PlazaStyle>(PlazaStyle.TopDown);
  return (
    <View style={styles.root}>
      <Segmented<PlazaStyle>
        value={style}
        onChange={setStyle}
        options={[
          { value: PlazaStyle.TopDown, label: '탑다운 광장' },
          { value: PlazaStyle.SideScroll, label: '횡스크롤 광장' },
        ]}
      />
      <CharacterPicker key={style} me={me} style={style} />
    </View>
  );
}

function CharacterPicker({ me, style }: { me: UserDetail; style: PlazaStyle }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const mine = useMyAssets().data ?? [];
  const side = style === PlazaStyle.SideScroll;
  const sameAsTopDown = side && !me.sideCharacter;
  const saved: CharacterChoice = characterFor(me, style) ?? defaultCharacter(me.id);
  const [choice, setChoice] = useState<CharacterChoice>(saved);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // 횡스크롤용 캐릭터는 탑다운 광장에서 쓸 수 없어서 횡스크롤 탭에만 보인다
  const options: { ref: string; manifest: AssetManifest }[] = [
    ...BUILTIN_CHARACTERS.map((ref) => ({ ref, manifest: builtinAsset(ref)! })),
    ...mine
      .filter(
        (asset) => asset.manifest.kind === 'character' && characterFitsStyle(asset.manifest, style),
      )
      .map((asset) => ({ ref: asset.id, manifest: asset.manifest })),
  ];
  const selected = options.find((o) => o.ref === choice.asset) ?? options[0]!;
  const palette = characterPalette(selected.manifest, choice.colors);
  const slots = COLOR_SLOTS.filter((slot) => selected.manifest.colorSlots?.[slot]);
  const dirty = characterKey(choice) !== characterKey(saved);

  const save = async (character: CharacterChoice | null, ok: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const detail = await apiSend<UserDetail>('/users/me/character', 'PUT', { character, style });
      queryClient.setQueryData(meQueryKey, detail);
      setChoice(characterFor(detail, style) ?? defaultCharacter(me.id));
      setStatus({ ok: true, text: ok });
    } catch (error) {
      setStatus({
        ok: false,
        text: error instanceof ApiError ? error.message : '저장하지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  // 색은 부위가 있는 캐릭터에만 남긴다 (직접 그린 캐릭터에는 보내지 않는다)
  const pick = (ref: string, manifest: AssetManifest) =>
    setChoice({
      asset: ref,
      colors: manifest.colorSlots ? { ...defaultCharacter(me.id).colors, ...choice.colors } : {},
    });

  return (
    <View style={styles.root}>
      {side && (
        <Text style={[styles.hint, { color: theme.muted }]}>
          횡스크롤 광장에서 쓸 캐릭터입니다. 횡스크롤용으로 그린 캐릭터는 여기서만 고를 수 있습니다.{' '}
          {sameAsTopDown
            ? '지금은 따로 고르지 않아 탑다운 광장과 같은 캐릭터를 씁니다.'
            : '따로 고른 캐릭터를 씁니다.'}
        </Text>
      )}
      <View style={[styles.stage, { backgroundColor: theme.bgInput }]}>
        <AssetPreview
          manifest={selected.manifest}
          box={144}
          palette={palette}
          animation={side ? 'walk-right' : 'walk-down'}
        />
        <View style={styles.turn}>
          {side
            ? SIDE_POSES.filter((pose) =>
                characterAnimation(selected.manifest, pose.animation),
              ).map((pose) => (
                <View key={pose.animation} style={styles.pose}>
                  <AssetPreview
                    manifest={selected.manifest}
                    box={52}
                    palette={palette}
                    animation={pose.animation}
                  />
                  <Text style={{ color: theme.muted, fontSize: 11 }}>{pose.label}</Text>
                </View>
              ))
            : DIRECTIONS.map((dir) => (
                <AssetPreview
                  key={dir}
                  manifest={selected.manifest}
                  box={52}
                  palette={palette}
                  animation={`walk-${dir}`}
                  dir={dir}
                />
              ))}
        </View>
      </View>

      <Text style={[styles.title, { color: theme.fg }]}>캐릭터</Text>
      <View style={styles.grid}>
        {options.map((option) => {
          const active = option.ref === selected.ref;
          return (
            <Pressable
              key={option.ref}
              onPress={() => pick(option.ref, option.manifest)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.manifest.name}
              style={[
                styles.card,
                {
                  borderColor: active ? theme.accent : theme.border,
                  backgroundColor: theme.bgSidebar,
                },
              ]}
            >
              <AssetPreview
                manifest={option.manifest}
                box={56}
                animate={false}
                animation={side ? 'idle-right' : 'idle-down'}
                palette={
                  option.manifest.colorSlots
                    ? characterPalette(option.manifest, choice.colors)
                    : undefined
                }
              />
              <Text style={{ color: theme.fg, fontSize: 12 }} numberOfLines={1}>
                {option.manifest.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {mine.length === 0 && (
        <Text style={[styles.hint, { color: theme.muted }]}>
          캐릭터를 직접 그리면 여기서 고를 수 있습니다 (웹·데스크톱의 설정 → 에셋).
        </Text>
      )}

      {slots.length > 0 && (
        <>
          <Text style={[styles.title, { color: theme.fg }]}>색</Text>
          {slots.map((slot) => (
            <View key={slot} style={styles.slot}>
              <Text style={[styles.slotLabel, { color: theme.muted }]}>{SLOT_LABEL[slot]}</Text>
              <View style={styles.swatches}>
                {COLOR_PRESETS[slot].map((color) => {
                  const active = choice.colors[slot] === color;
                  return (
                    <Pressable
                      key={color}
                      onPress={() =>
                        setChoice({ ...choice, colors: { ...choice.colors, [slot]: color } })
                      }
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${SLOT_LABEL[slot]} ${color}`}
                      hitSlop={3}
                      style={[
                        styles.swatch,
                        { backgroundColor: color, borderColor: active ? theme.fg : theme.border },
                        active && styles.swatchActive,
                      ]}
                    />
                  );
                })}
              </View>
            </View>
          ))}
        </>
      )}

      {status && <Text style={{ color: status.ok ? theme.ok : theme.danger }}>{status.text}</Text>}
      <View style={styles.footer}>
        <View style={styles.footerButton}>
          {side ? (
            <Button
              label="탑다운과 같게"
              disabled={busy || sameAsTopDown}
              onPress={() => void save(null, '탑다운 광장과 같은 캐릭터를 씁니다.')}
            />
          ) : (
            <Button
              label="기본으로"
              disabled={busy || me.character === null}
              onPress={() => void save(null, '기본 캐릭터로 되돌렸습니다.')}
            />
          )}
        </View>
        <View style={styles.footerButton}>
          <Button
            label="저장"
            variant="primary"
            busy={busy}
            disabled={!dirty}
            onPress={() =>
              void save({ asset: selected.ref, colors: choice.colors }, '저장했습니다.')
            }
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  hint: { fontSize: 13 },
  stage: { borderRadius: 12, padding: 12, alignItems: 'center', gap: 8 },
  turn: { flexDirection: 'row', gap: 8 },
  pose: { alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: {
    width: 84,
    alignItems: 'center',
    gap: 4,
    padding: 6,
    borderRadius: 10,
    borderWidth: 2,
  },
  slot: { gap: 6 },
  slotLabel: { fontSize: 12, fontWeight: '700' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2 },
  swatchActive: { transform: [{ scale: 1.15 }] },
  footer: { flexDirection: 'row', gap: 8, marginTop: 4 },
  footerButton: { flex: 1 },
});
