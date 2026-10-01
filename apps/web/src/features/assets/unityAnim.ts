import type { DecodedGif } from './gif';

/**
 * 유니티 스프라이트 애니메이션 가져오기·내보내기.
 * - .anim (AnimationClip): m_PPtrCurves의 m_Sprite 곡선 = 시각마다 보여 줄 스프라이트 (fileID + 그림의 guid)
 * - 그림의 .meta (TextureImporter): guid와 스프라이트 시트의 칸들 (이름, 사각형, 기준점, fileID)
 * - 그림(PNG)
 * 유니티 YAML은 형식이 일정해서 필요한 항목만 줄 단위로 읽는다 (YAML 라이브러리를 쓰지 않음).
 * 유니티 좌표는 아래가 0이고, 스프라이트마다 기준점(pivot)이 달라 기준점을 맞춰 한 그림으로 모은다.
 */

/** 클립의 열쇠 하나: 이 시각부터 보여 줄 스프라이트 */
export interface UnityKey {
  time: number;
  fileID: string;
  guid: string;
}

export interface UnityClip {
  name: string;
  sampleRate: number;
  loop: boolean;
  /** 클립 길이 (초). 마지막 스프라이트를 얼마나 보여 줄지 정한다 */
  stopTime: number | null;
  keys: UnityKey[];
}

export interface UnitySprite {
  fileID: string;
  name: string;
  /** 아래 왼쪽이 원점인 사각형. 한 장짜리(Single) 그림은 null = 그림 전체 */
  rect: { x: number; y: number; width: number; height: number } | null;
  /** 0~1 비율 (x 왼쪽→오른쪽, y 아래→위) */
  pivot: { x: number; y: number };
}

export interface UnitySpriteMeta {
  guid: string;
  sprites: UnitySprite[];
}

export interface RgbaImage {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 한 장짜리 스프라이트의 fileID (유니티가 늘 쓰는 값) */
export const SINGLE_SPRITE_FILE_ID = '21300000';

/** 유니티 SpriteAlignment → 기준점 (9 = Custom은 pivot 값을 그대로) */
const ALIGNMENT_PIVOT: Record<number, { x: number; y: number }> = {
  0: { x: 0.5, y: 0.5 },
  1: { x: 0, y: 1 },
  2: { x: 0.5, y: 1 },
  3: { x: 1, y: 1 },
  4: { x: 0, y: 0.5 },
  5: { x: 1, y: 0.5 },
  6: { x: 0, y: 0 },
  7: { x: 0.5, y: 0 },
  8: { x: 1, y: 0 },
};

const num = (text: string | undefined, fallback: number) => {
  const value = Number(text);
  return text !== undefined && Number.isFinite(value) ? value : fallback;
};

const indentOf = (line: string) => line.length - line.trimStart().length;

/** key: 줄 다음부터 그 줄보다 깊게 들여 쓴 줄들 (그 항목의 내용) */
function blockAfter(lines: string[], key: RegExp): string[] {
  const start = lines.findIndex((line) => key.test(line));
  if (start === -1) return [];
  const indent = indentOf(lines[start]!);
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    // 같은 깊이의 목록(- )은 YAML에서 그 항목의 값이므로 함께 넣는다.
    if (
      indentOf(line) < indent ||
      (indentOf(line) === indent && !line.trimStart().startsWith('-'))
    ) {
      break;
    }
    block.push(line);
  }
  return block;
}

/** 목록 블록을 항목(- 로 시작하는 줄)마다 나눈다 */
function listItems(block: string[]): string[] {
  const first = block.find((line) => line.trimStart().startsWith('- '));
  if (!first) return [];
  const indent = indentOf(first);
  const items: string[][] = [];
  for (const line of block) {
    if (indentOf(line) === indent && line.trimStart().startsWith('- ')) items.push([]);
    items.at(-1)?.push(line);
  }
  return items.map((lines) => lines.join('\n'));
}

const normalize = (text: string) => text.replace(/\r\n?/g, '\n');

/** .anim(AnimationClip)에서 스프라이트 곡선을 읽는다. 스프라이트 애니메이션이 아니면 null */
export function parseAnimClip(text: string, fallbackName: string): UnityClip | null {
  const source = normalize(text);
  if (!/^\s*AnimationClip:/m.test(source)) return null;
  const lines = source.split('\n');
  const curves = listItems(blockAfter(lines, /^\s*m_PPtrCurves:\s*$/));
  const sprite = curves.find((curve) => /attribute:\s*m_Sprite\b/.test(curve));
  if (!sprite) return null;
  const keys: UnityKey[] = [];
  const keyPattern =
    /-\s*time:\s*([-\d.eE+]+)\s*\n\s*value:\s*\{\s*fileID:\s*(-?\d+),\s*guid:\s*([0-9a-f]{32})/g;
  for (const match of sprite.matchAll(keyPattern)) {
    keys.push({ time: num(match[1], 0), fileID: match[2]!, guid: match[3]! });
  }
  if (keys.length === 0) return null;
  keys.sort((a, b) => a.time - b.time);
  const name = /^\s*m_Name:\s*(.*)$/m.exec(source)?.[1]?.trim() || fallbackName;
  const stop = /^\s*m_StopTime:\s*([-\d.eE+]+)/m.exec(source)?.[1];
  const loop = /^\s*m_LoopTime:\s*(\d)/m.exec(source)?.[1];
  return {
    name,
    sampleRate: Math.max(1, num(/^\s*m_SampleRate:\s*([\d.]+)/m.exec(source)?.[1], 60)),
    loop: loop === undefined ? true : loop === '1',
    stopTime: stop === undefined ? null : num(stop, 0),
    keys,
  };
}

/** 그림 .meta(TextureImporter)에서 guid와 스프라이트 칸들을 읽는다. 그림의 .meta가 아니면 null */
export function parseSpriteMeta(text: string): UnitySpriteMeta | null {
  const source = normalize(text);
  const guid = /^guid:\s*([0-9a-f]{32})/m.exec(source)?.[1];
  if (!guid || !/TextureImporter:/.test(source)) return null;
  const lines = source.split('\n');

  // 이름 → fileID: 새 형식(nameFileIdTable), 2018~2020(internalIDToNameTable), 옛 형식(fileIDToRecycleName)
  const idByName = new Map<string, string>();
  for (const line of blockAfter(lines, /^\s*nameFileIdTable:\s*$/)) {
    const m = /^\s*(.+?):\s*(-?\d+)\s*$/.exec(line);
    if (m) idByName.set(m[1]!.trim(), m[2]!);
  }
  for (const item of listItems(blockAfter(lines, /^\s*internalIDToNameTable:\s*$/))) {
    const id = /213:\s*(-?\d+)/.exec(item)?.[1];
    const name = /second:\s*(.+)$/m.exec(item)?.[1]?.trim();
    if (id && name) idByName.set(name, id);
  }
  for (const line of blockAfter(lines, /^\s*fileIDToRecycleName:\s*$/)) {
    const m = /^\s*(-?\d+):\s*(.+)$/.exec(line);
    if (m) idByName.set(m[2]!.trim(), m[1]!);
  }

  const spriteMode = num(/^\s*spriteMode:\s*(\d)/m.exec(source)?.[1], 1);
  const sheet = listItems(blockAfter(lines, /^\s*sprites:\s*$/));
  if (spriteMode !== 2 || sheet.length === 0) {
    const alignment = num(/^\s*(?:spriteAlignment|alignment):\s*(\d+)/m.exec(source)?.[1], 0);
    const custom = /spritePivot:\s*\{x:\s*([-\d.]+),\s*y:\s*([-\d.]+)\}/.exec(source);
    return {
      guid,
      sprites: [
        {
          fileID: SINGLE_SPRITE_FILE_ID,
          name: 'sprite',
          rect: null,
          pivot:
            alignment === 9 && custom
              ? { x: num(custom[1], 0.5), y: num(custom[2], 0.5) }
              : (ALIGNMENT_PIVOT[alignment] ?? ALIGNMENT_PIVOT[0]!),
        },
      ],
    };
  }

  const sprites: UnitySprite[] = [];
  for (const item of sheet) {
    const name = /^\s*-?\s*name:\s*(.+)$/m.exec(item)?.[1]?.trim() ?? '';
    const rect =
      /rect:\s*\n(?:\s*serializedVersion:.*\n)?\s*x:\s*([-\d.]+)\s*\n\s*y:\s*([-\d.]+)\s*\n\s*width:\s*([-\d.]+)\s*\n\s*height:\s*([-\d.]+)/.exec(
        item,
      );
    if (!rect) continue;
    const alignment = num(/^\s*alignment:\s*(\d+)/m.exec(item)?.[1], 0);
    const custom = /pivot:\s*\{x:\s*([-\d.]+),\s*y:\s*([-\d.]+)\}/.exec(item);
    const internal = /internalID:\s*(-?\d+)/.exec(item)?.[1];
    const fileID = internal && internal !== '0' ? internal : idByName.get(name);
    if (!fileID) continue;
    sprites.push({
      fileID,
      name,
      rect: {
        x: Math.round(num(rect[1], 0)),
        y: Math.round(num(rect[2], 0)),
        width: Math.round(num(rect[3], 0)),
        height: Math.round(num(rect[4], 0)),
      },
      pivot:
        alignment === 9 && custom
          ? { x: num(custom[1], 0.5), y: num(custom[2], 0.5) }
          : (ALIGNMENT_PIVOT[alignment] ?? ALIGNMENT_PIVOT[0]!),
    });
  }
  return { guid, sprites };
}

/** 너무 짧은 장면은 이 시간으로 본다 (ms) */
const MIN_DELAY_MS = 10;

/**
 * 클립을 장면들(RGBA)과 장면마다 보여 줄 시간으로. 스프라이트마다 기준점이 달라도 기준점을 맞춰
 * 모든 장면이 들어가는 크기의 그림으로 모은다 (캐릭터라면 발밑이 같은 자리에 오게).
 */
export function clipToFrames(
  clip: UnityClip,
  metas: ReadonlyMap<string, UnitySpriteMeta>,
  images: ReadonlyMap<string, RgbaImage>,
): { gif: DecodedGif } | { error: string } {
  const placed: {
    image: RgbaImage;
    rect: NonNullable<UnitySprite['rect']>;
    px: number;
    py: number;
  }[] = [];
  for (const key of clip.keys) {
    const meta = metas.get(key.guid);
    const image = images.get(key.guid);
    if (!meta || !image) {
      return { error: `${clip.name}: 그림(PNG)과 그 .meta를 함께 넣어 주세요 (guid ${key.guid}).` };
    }
    const sprite =
      meta.sprites.find((s) => s.fileID === key.fileID) ??
      (meta.sprites.length === 1 ? meta.sprites[0] : undefined);
    if (!sprite)
      return { error: `${clip.name}: .meta에 없는 스프라이트가 있습니다 (${key.fileID}).` };
    const rect = sprite.rect ?? { x: 0, y: 0, width: image.width, height: image.height };
    if (
      rect.x < 0 ||
      rect.y < 0 ||
      rect.x + rect.width > image.width ||
      rect.y + rect.height > image.height
    ) {
      return { error: `${clip.name}: 스프라이트 ${sprite.name}이(가) 그림 밖에 있습니다.` };
    }
    placed.push({
      image,
      rect,
      px: Math.round(sprite.pivot.x * rect.width),
      py: Math.round(sprite.pivot.y * rect.height),
    });
  }

  // 기준점을 원점으로 한 좌표(위가 +y)에서 모든 장면을 덮는 크기
  const left = Math.min(...placed.map((p) => -p.px));
  const right = Math.max(...placed.map((p) => p.rect.width - p.px));
  const bottom = Math.min(...placed.map((p) => -p.py));
  const top = Math.max(...placed.map((p) => p.rect.height - p.py));
  const width = right - left;
  const height = top - bottom;

  const frames = placed.map(({ image, rect, px, py }) => {
    const out = new Uint8ClampedArray(width * height * 4);
    // 그림 위쪽 줄(0)부터: 사각형의 위 끝 = 그림 높이 - (y + 높이)
    const srcTop = image.height - (rect.y + rect.height);
    const dx = -px - left;
    const dy = top - (rect.height - py);
    for (let y = 0; y < rect.height; y++) {
      const from = ((srcTop + y) * image.width + rect.x) * 4;
      out.set(image.rgba.subarray(from, from + rect.width * 4), ((dy + y) * width + dx) * 4);
    }
    return out;
  });

  const end = clip.stopTime && clip.stopTime > clip.keys.at(-1)!.time ? clip.stopTime : null;
  const delays = clip.keys.map((key, i) => {
    const next = clip.keys[i + 1]?.time ?? end ?? key.time + 1 / clip.sampleRate;
    return Math.max(MIN_DELAY_MS, Math.round((next - key.time) * 1000));
  });
  return { gif: { width, height, frames, delays } };
}

// ── 내보내기 ──

/** 유니티 guid (32자리 16진수) */
export function randomGuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 시트의 i번째 스프라이트 fileID (옛 유니티가 쓰던 213xxxxx 꼴이라 어느 버전에서나 읽힌다) */
export const spriteFileId = (index: number) => String(21300000 + index * 2);

export interface SheetSprite {
  name: string;
  fileID: string;
  /** 아래 왼쪽이 원점 (유니티 좌표) */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 스프라이트 시트 그림의 .meta: 도트 그대로(Point, 압축 없음), 칸마다 발밑 가운데 기준점 */
export function writeSpriteMeta(options: {
  guid: string;
  sprites: SheetSprite[];
  pixelsPerUnit: number;
}): string {
  const { guid, sprites, pixelsPerUnit } = options;
  const sheet = sprites
    .map(
      (s) => `    - serializedVersion: 2
      name: ${s.name}
      rect:
        serializedVersion: 2
        x: ${s.x}
        y: ${s.y}
        width: ${s.width}
        height: ${s.height}
      alignment: 7
      pivot: {x: 0.5, y: 0}
      border: {x: 0, y: 0, z: 0, w: 0}
      outline: []
      physicsShape: []
      tessellationDetail: 0
      bones: []
      spriteID: ${randomGuid()}
      internalID: ${s.fileID}
      vertices: []
      indices:
      edges: []
      weights: []`,
    )
    .join('\n');
  const names = sprites.map((s) => `      ${s.name}: ${s.fileID}`).join('\n');
  return `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 12
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
  isReadable: 0
  textureFormat: 1
  maxTextureSize: 4096
  textureSettings:
    serializedVersion: 2
    filterMode: 0
    aniso: 1
    mipBias: 0
    wrapU: 1
    wrapV: 1
    wrapW: 1
  nPOTScale: 0
  lightmap: 0
  compressionQuality: 50
  spriteMode: 2
  spriteExtrude: 1
  spriteMeshType: 0
  alignment: 7
  spritePivot: {x: 0.5, y: 0}
  spritePixelsToUnits: ${pixelsPerUnit}
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: 1
  textureType: 8
  textureShape: 1
  platformSettings:
  - serializedVersion: 3
    buildTarget: DefaultTexturePlatform
    maxTextureSize: 4096
    textureCompression: 0
    compressionQuality: 50
  spriteSheet:
    serializedVersion: 2
    sprites:
${sheet}
    outline: []
    physicsShape: []
    bones: []
    spriteID:
    internalID: 0
    vertices: []
    indices:
    edges: []
    weights: []
    secondaryTextures: []
    nameFileIdTable:
${names}
  spritePackingTag:
  pSDRemoveMatte: 0
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

/** 스프라이트 애니메이션 클립(.anim). 장면마다 같은 간격이고, 반복 여부를 m_LoopTime에 적는다 */
export function writeAnimClip(options: {
  name: string;
  guid: string;
  /** 장면마다 보여 줄 스프라이트 fileID */
  frames: string[];
  frameMs: number;
  loop: boolean;
}): string {
  const { name, guid, frames, frameMs, loop } = options;
  const seconds = (ms: number) => Number((ms / 1000).toFixed(6));
  const keys = frames
    .map(
      (fileID, i) => `    - time: ${seconds(i * frameMs)}
      value: {fileID: ${fileID}, guid: ${guid}, type: 3}`,
    )
    .join('\n');
  const mapping = [...new Set(frames)]
    .map((fileID) => `    - {fileID: ${fileID}, guid: ${guid}, type: 3}`)
    .join('\n');
  const stop = seconds(frames.length * frameMs);
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!74 &7400000
AnimationClip:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: ${name}
  serializedVersion: 7
  m_Legacy: 0
  m_Compressed: 0
  m_UseHighQualityCurve: 1
  m_RotationCurves: []
  m_CompressedRotationCurves: []
  m_EulerCurves: []
  m_PositionCurves: []
  m_ScaleCurves: []
  m_FloatCurves: []
  m_PPtrCurves:
  - curve:
${keys}
    attribute: m_Sprite
    path:
    classID: 212
    script: {fileID: 0}
    flags: 2
  m_SampleRate: ${Math.max(1, Math.round(1000 / frameMs))}
  m_WrapMode: 0
  m_Bounds:
    m_Center: {x: 0, y: 0, z: 0}
    m_Extent: {x: 0, y: 0, z: 0}
  m_ClipBindingConstant:
    genericBindings:
    - serializedVersion: 2
      path: 0
      attribute: 0
      script: {fileID: 0}
      typeID: 212
      customType: 23
      isPPtrCurve: 1
      isIntCurve: 0
      isSerializeReferenceCurve: 0
    pptrCurveMapping:
${mapping}
  m_AnimationClipSettings:
    serializedVersion: 2
    m_AdditiveReferencePoseClip: {fileID: 0}
    m_AdditiveReferencePoseTime: 0
    m_StartTime: 0
    m_StopTime: ${stop}
    m_OrientationOffsetY: 0
    m_Level: 0
    m_CycleOffset: 0
    m_HasAdditiveReferencePose: 0
    m_LoopTime: ${loop ? 1 : 0}
    m_LoopBlend: 0
    m_LoopBlendOrientation: 0
    m_LoopBlendPositionY: 0
    m_LoopBlendPositionXZ: 0
    m_KeepOriginalOrientation: 0
    m_KeepOriginalPositionY: 1
    m_KeepOriginalPositionXZ: 0
    m_HeightFromFeet: 0
    m_Mirror: 0
  m_EditorCurves: []
  m_EulerEditorCurves: []
  m_HasGenericRootTransform: 0
  m_HasMotionFloatCurves: 0
  m_Events: []
`;
}
