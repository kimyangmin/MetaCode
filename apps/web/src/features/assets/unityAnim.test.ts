import { describe, expect, it } from 'vitest';
import {
  type RgbaImage,
  SINGLE_SPRITE_FILE_ID,
  clipToFrames,
  parseAnimClip,
  parseSpriteMeta,
  spriteFileId,
  writeAnimClip,
  writeSpriteMeta,
} from './unityAnim';
import { crc32, zipFiles } from './zip';

const GUID = '0123456789abcdef0123456789abcdef';

/** 유니티 2022가 만든 것과 같은 꼴의 클립 (CRLF 줄바꿈, 마지막 장면은 m_StopTime까지) */
const RUN_ANIM = [
  '%YAML 1.1',
  '%TAG !u! tag:unity3d.com,2011:',
  '--- !u!74 &7400000',
  'AnimationClip:',
  '  m_ObjectHideFlags: 0',
  '  m_Name: Player_Run',
  '  m_FloatCurves: []',
  '  m_PPtrCurves:',
  '  - curve:',
  '    - time: 0',
  `      value: {fileID: -1234567, guid: ${GUID}, type: 3}`,
  '    - time: 0.1',
  `      value: {fileID: 987654, guid: ${GUID}, type: 3}`,
  '    - time: 0.3',
  `      value: {fileID: -1234567, guid: ${GUID}, type: 3}`,
  '    attribute: m_Sprite',
  '    path: ',
  '    classID: 212',
  '  m_SampleRate: 10',
  '  m_AnimationClipSettings:',
  '    m_StopTime: 0.4',
  '    m_LoopTime: 1',
  '  m_Events: []',
].join('\r\n');

/** 두 칸짜리 시트 (4×4 그림, 아래 줄 두 칸이 스프라이트). 하나는 발밑 가운데, 하나는 직접 정한 기준점 */
const SHEET_META = `fileFormatVersion: 2
guid: ${GUID}
TextureImporter:
  spriteMode: 2
  spriteSheet:
    serializedVersion: 2
    sprites:
    - serializedVersion: 2
      name: run_0
      rect:
        serializedVersion: 2
        x: 0
        y: 0
        width: 2
        height: 2
      alignment: 7
      pivot: {x: 0.5, y: 0}
      internalID: -1234567
    - serializedVersion: 2
      name: run_1
      rect:
        serializedVersion: 2
        x: 2
        y: 0
        width: 2
        height: 3
      alignment: 9
      pivot: {x: 0.5, y: 0}
      internalID: 0
    outline: []
    nameFileIdTable:
      run_0: -1234567
      run_1: 987654
  spritePackingTag:
`;

/** 4×4 그림: 아래 왼쪽 2×2는 빨강, 오른쪽 2×3은 파랑 (나머지 투명) */
function sheetImage(): RgbaImage {
  const width = 4;
  const height = 4;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const set = (x: number, y: number, rgb: [number, number, number]) =>
    rgba.set([...rgb, 255], (y * width + x) * 4);
  for (let y = 2; y < 4; y++) for (let x = 0; x < 2; x++) set(x, y, [255, 0, 0]);
  for (let y = 1; y < 4; y++) for (let x = 2; x < 4; x++) set(x, y, [0, 0, 255]);
  return { rgba, width, height };
}

describe('유니티 .anim 읽기', () => {
  it('스프라이트 곡선의 시각·스프라이트, 이름, 반복, 길이를 읽는다', () => {
    const clip = parseAnimClip(RUN_ANIM, 'fallback')!;
    expect(clip).toMatchObject({ name: 'Player_Run', sampleRate: 10, loop: true, stopTime: 0.4 });
    expect(clip.keys.map((k) => [k.time, k.fileID])).toEqual([
      [0, '-1234567'],
      [0.1, '987654'],
      [0.3, '-1234567'],
    ]);
  });

  it('스프라이트 애니메이션이 아니면 null', () => {
    expect(parseAnimClip('AnimationClip:\n  m_PPtrCurves: []\n', 'x')).toBeNull();
    expect(parseAnimClip('Material:\n', 'x')).toBeNull();
  });

  it('.meta의 칸마다 fileID(internalID 또는 이름 표)·사각형·기준점을 읽는다', () => {
    const meta = parseSpriteMeta(SHEET_META)!;
    expect(meta.guid).toBe(GUID);
    expect(meta.sprites).toEqual([
      {
        fileID: '-1234567',
        name: 'run_0',
        rect: { x: 0, y: 0, width: 2, height: 2 },
        pivot: { x: 0.5, y: 0 },
      },
      {
        fileID: '987654',
        name: 'run_1',
        rect: { x: 2, y: 0, width: 2, height: 3 },
        pivot: { x: 0.5, y: 0 },
      },
    ]);
  });

  it('옛 형식(fileIDToRecycleName)과 한 장짜리 그림도 읽는다', () => {
    const old = SHEET_META.replace(/internalID: -?\d+/g, 'internalID: 0')
      .replace(/ {4}nameFileIdTable:[\s\S]*?(?=\n {2}spritePackingTag)/, '')
      .replace(
        'TextureImporter:\n',
        'TextureImporter:\n  fileIDToRecycleName:\n    21300000: run_0\n    21300002: run_1\n',
      );
    expect(parseSpriteMeta(old)!.sprites.map((s) => s.fileID)).toEqual(['21300000', '21300002']);
    const single = parseSpriteMeta(
      `fileFormatVersion: 2\nguid: ${GUID}\nTextureImporter:\n  spriteMode: 1\n  alignment: 7\n`,
    )!;
    expect(single.sprites).toEqual([
      { fileID: SINGLE_SPRITE_FILE_ID, name: 'sprite', rect: null, pivot: { x: 0.5, y: 0 } },
    ]);
  });

  it('기준점을 맞춰 한 그림으로 모으고, 장면 시간은 다음 장면까지(마지막은 클립 끝까지)', () => {
    const clip = parseAnimClip(RUN_ANIM, 'x')!;
    const result = clipToFrames(
      clip,
      new Map([[GUID, parseSpriteMeta(SHEET_META)!]]),
      new Map([[GUID, sheetImage()]]),
    );
    if ('error' in result) throw new Error(result.error);
    const { gif } = result;
    // 둘 다 발밑 가운데가 기준이라 가로 2, 세로는 큰 쪽(3)
    expect([gif.width, gif.height]).toEqual([2, 3]);
    expect(gif.delays).toEqual([100, 200, 100]);
    const alpha = (frame: Uint8ClampedArray) =>
      Array.from({ length: 6 }, (_, i) => (frame[i * 4 + 3]! > 0 ? 1 : 0));
    // 빨강 2×2는 아래 두 줄에 (위 줄은 비어 있음), 파랑 2×3은 꽉 참
    expect(alpha(gif.frames[0]!)).toEqual([0, 0, 1, 1, 1, 1]);
    expect(alpha(gif.frames[1]!)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(gif.frames[1]![2]).toBe(255);
  });

  it('그림이나 .meta가 없으면 무엇을 넣어야 하는지 알린다', () => {
    const clip = parseAnimClip(RUN_ANIM, 'x')!;
    const result = clipToFrames(clip, new Map(), new Map());
    expect('error' in result && result.error).toMatch(/PNG.*\.meta/);
  });
});

describe('유니티로 내보내기', () => {
  it('내보낸 .meta와 .anim을 다시 읽으면 같은 칸·순서·시간이다', () => {
    const sprites = [0, 1].map((i) => ({
      name: `hero_${i}`,
      fileID: spriteFileId(i),
      x: i * 16,
      y: 0,
      width: 16,
      height: 32,
    }));
    const meta = parseSpriteMeta(writeSpriteMeta({ guid: GUID, sprites, pixelsPerUnit: 16 }))!;
    expect(meta.sprites.map((s) => [s.fileID, s.rect])).toEqual(
      sprites.map((s) => [s.fileID, { x: s.x, y: 0, width: 16, height: 32 }]),
    );
    const anim = writeAnimClip({
      name: 'walk-right',
      guid: GUID,
      frames: [spriteFileId(0), spriteFileId(1), spriteFileId(0)],
      frameMs: 125,
      loop: false,
    });
    const clip = parseAnimClip(anim, 'x')!;
    expect(clip).toMatchObject({ name: 'walk-right', sampleRate: 8, loop: false, stopTime: 0.375 });
    expect(clip.keys.map((k) => [k.time, k.fileID])).toEqual([
      [0, spriteFileId(0)],
      [0.125, spriteFileId(1)],
      [0.25, spriteFileId(0)],
    ]);
  });
});

describe('ZIP', () => {
  it('CRC-32와 파일 머리가 맞다', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    const zip = zipFiles([{ name: '한글.txt', data: new TextEncoder().encode('hello') }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(0x3610a686);
    // 끝 레코드: 파일 1개
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(1);
  });
});
