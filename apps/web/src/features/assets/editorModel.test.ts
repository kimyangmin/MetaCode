import { assetManifestSchema, missingAnimations } from '@metacode/shared';
import { builtinAsset } from '@metacode/shared/builtin-assets';
import { describe, expect, it } from 'vitest';
import { PixelDocument, fromManifest, newDoc, toManifest } from './editorModel';
import { indexImage } from './png';

const at = { animation: 0, frame: 0 };

describe('문서와 매니페스트', () => {
  it('내장 캐릭터를 불러와 그대로 저장하면 같은 그림이고, 같은 프레임은 합친다', () => {
    const source = builtinAsset('builtin:char-short')!;
    const doc = fromManifest(source);
    // 첨부 모션은 같은 두 프레임을 되풀이하지만 에디터에서는 다섯 장으로 펼친다.
    expect(doc.animations.find((a) => a.name === 'emote')!.frames).toHaveLength(5);
    const saved = toManifest(doc);
    expect(saved.frames).toHaveLength(source.frames.length);
    expect(assetManifestSchema.safeParse(saved).success).toBe(true);
    expect(saved.colorSlots).toEqual(source.colorSlots);
  });

  it('새 캐릭터는 필수 애니메이션이 모두 있지만 비어 있어서 저장할 수 없다', () => {
    const manifest = toManifest(newDoc('character', '새 캐릭터'));
    expect(Object.keys(manifest.animations)).toHaveLength(9);
    expect(missingAnimations(manifest)).toHaveLength(9);
  });

  it('새 오브젝트는 아래 줄만 막는다', () => {
    const doc = newDoc('object', '의자', { w: 2, h: 2 });
    expect(doc.footprint).toEqual([0, 0, 1, 1]);
    expect(toManifest(doc).footprint).toEqual([0, 0, 1, 1]);
  });
});

describe('그리기', () => {
  it('좌우 대칭으로 칠하고, 한 붓질은 되돌리기 한 번에 돌아간다', () => {
    const doc = new PixelDocument(newDoc('tile', '타일'));
    doc.begin();
    doc.paint(at, 1, 2, 3, true);
    doc.line(at, { x: 0, y: 0 }, { x: 3, y: 0 }, 4);
    expect(doc.pick(at, 1, 2)).toBe(3);
    expect(doc.pick(at, 14, 2)).toBe(3);
    expect([0, 1, 2, 3].map((x) => doc.pick(at, x, 0))).toEqual([4, 4, 4, 4]);
    expect(doc.dirty).toBe(true);

    doc.undo();
    expect(doc.pick(at, 1, 2)).toBe(0);
    expect(doc.pick(at, 3, 0)).toBe(0);
    doc.redo();
    expect(doc.pick(at, 14, 2)).toBe(3);
  });

  it('채우기는 이어진 같은 색만 칠한다', () => {
    const doc = new PixelDocument(newDoc('tile', '타일'));
    doc.begin();
    for (let y = 0; y < 16; y++) doc.paint(at, 8, y, 1); // 세로 벽
    doc.fill(at, 0, 0, 2);
    expect(doc.pick(at, 7, 15)).toBe(2);
    expect(doc.pick(at, 8, 3)).toBe(1);
    expect(doc.pick(at, 9, 3)).toBe(0);
  });

  it('색을 지우면 그 색 픽셀은 투명해지고 뒤의 번호는 당겨진다', () => {
    const doc = new PixelDocument(newDoc('tile', '타일'));
    doc.begin();
    doc.paint(at, 0, 0, 2);
    doc.paint(at, 1, 0, 3);
    const third = doc.doc.palette[2];
    doc.removeColor(2);
    expect(doc.pick(at, 0, 0)).toBe(0);
    expect(doc.pick(at, 1, 0)).toBe(2);
    expect(doc.doc.palette[1]).toBe(third);
  });

  it('프레임 넣기·복제·옮기기·지우기', () => {
    const doc = new PixelDocument(newDoc('tile', '물'));
    doc.begin();
    doc.paint(at, 0, 0, 5);
    expect(doc.addFrame(at, true)).toBe(1);
    expect(doc.pick({ animation: 0, frame: 1 }, 0, 0)).toBe(5);
    doc.addFrame({ animation: 0, frame: 1 }, false);
    doc.moveFrame({ animation: 0, frame: 2 }, 0);
    expect(doc.pick(at, 0, 0)).toBe(0);
    doc.removeFrame(at);
    expect(doc.doc.animations[0]!.frames).toHaveLength(2);
    // 같은 그림 두 장은 저장할 때 한 장으로 센다.
    expect(doc.frameCount()).toBe(1);
  });

  it('오브젝트 크기를 바꾸면 그림과 막힌 칸이 왼쪽 아래를 기준으로 남는다', () => {
    const doc = new PixelDocument(newDoc('object', '돌', { w: 1, h: 1 }));
    doc.begin();
    doc.paint(at, 2, 15, 1);
    doc.resize(2, 2);
    expect(doc.doc.width).toBe(32);
    expect(doc.pick(at, 2, 31)).toBe(1);
    expect(doc.doc.footprint).toEqual([0, 0, 1, 0]);
  });

  it('캐릭터 해상도를 바꾸면 그림이 발밑 가운데를 기준으로 남는다', () => {
    const doc = new PixelDocument(newDoc('character', '나'));
    expect([doc.doc.width, doc.doc.height]).toEqual([16, 32]);
    doc.begin();
    doc.paint(at, 0, 0, 1); // 왼쪽 위 끝
    doc.paint(at, 8, 31, 2); // 발밑 가운데

    doc.resizeCharacter(32);
    expect([doc.doc.width, doc.doc.height]).toEqual([32, 64]);
    expect(doc.pick(at, 8, 32)).toBe(1); // 가로로 8칸, 세로로 32칸 밀렸다
    expect(doc.pick(at, 16, 63)).toBe(2);
    // 저장할 매니페스트도 새 해상도로 검증을 통과한다.
    expect(toManifest(doc.doc).width).toBe(32);

    doc.resizeCharacter(16);
    expect([doc.doc.width, doc.doc.height]).toEqual([16, 32]);
    expect(doc.pick(at, 8, 31)).toBe(2);
  });

  it('범위 밖이거나 캐릭터가 아니면 해상도를 바꾸지 않는다', () => {
    const object = new PixelDocument(newDoc('object', '돌'));
    object.resizeCharacter(32);
    expect(object.doc.width).toBe(16);
  });
});

describe('PNG 가져오기', () => {
  const pixel = (r: number, g: number, b: number, a = 255) => [r, g, b, a];

  it('가로로 이어 붙인 시트를 프레임으로 나누고, 없는 색은 팔레트에 더한다', () => {
    // 2×1 프레임 두 장: [빨강, 투명] [초록, 빨강]
    const rgba = Uint8ClampedArray.from([
      ...pixel(255, 0, 0),
      ...pixel(0, 0, 0, 0),
      ...pixel(0, 255, 0),
      ...pixel(255, 0, 0),
    ]);
    const result = indexImage(rgba, 4, 1, 2, 1, ['#ff0000']);
    expect(result).toEqual({
      frames: [Uint8Array.from([1, 0]), Uint8Array.from([2, 1])],
      palette: ['#ff0000', '#00ff00'],
    });
  });

  it('크기가 맞지 않으면 거절하고, 팔레트가 가득 차면 가까운 색을 쓴다', () => {
    expect(indexImage(new Uint8ClampedArray(12), 3, 1, 2, 1, [])).toHaveProperty('error');
    const full = Array.from(
      { length: 64 },
      (_, i) => `#${(i * 4).toString(16).padStart(2, '0')}0000`,
    );
    const result = indexImage(Uint8ClampedArray.from(pixel(9, 1, 1)), 1, 1, 1, 1, full);
    expect('frames' in result && result.frames[0]![0]).toBe(3); // #080000
  });
});

describe('색 바꾸기', () => {
  it('같은 색을 이어서 바꾸면 되돌리기 한 번에 처음 색으로 돌아간다', () => {
    const doc = new PixelDocument(newDoc('tile', '타일'));
    const first = doc.doc.palette[0];
    doc.setColor(1, '#111111');
    doc.setColor(1, '#222222');
    doc.setColor(1, '#333333');
    doc.undo();
    expect(doc.doc.palette[0]).toBe(first);
    expect(doc.canUndo).toBe(false);
  });
});

describe('발 아래 빈 줄 정리', () => {
  it('모든 프레임에 공통으로 빈 줄만큼 내리고, 프레임끼리의 높이 차이는 남긴다', () => {
    const doc = new PixelDocument(newDoc('character', '캐릭터'));
    const { width, height } = doc.doc;
    doc.begin();
    // idle-down: 발이 아래에서 3줄 위, walk-down 첫 프레임: 4줄 위 (들썩임)
    doc.paint({ animation: 0, frame: 0 }, 5, height - 4, 1);
    doc.paint({ animation: 4, frame: 0 }, 5, height - 5, 1);
    expect(doc.trimBelowFeet()).toBe(3);
    expect(doc.pick({ animation: 0, frame: 0 }, 5, height - 1)).toBe(1);
    expect(doc.pick({ animation: 4, frame: 0 }, 5, height - 2)).toBe(1);
    expect(doc.doc.width).toBe(width);
    // 이미 정리했으면 아무것도 하지 않고, 되돌리기 한 번에 돌아간다.
    expect(doc.trimBelowFeet()).toBe(0);
    doc.undo();
    expect(doc.pick({ animation: 0, frame: 0 }, 5, height - 4)).toBe(1);
  });

  it('캐릭터가 아니거나 그림이 없으면 하지 않는다', () => {
    expect(new PixelDocument(newDoc('character', '빈')).trimBelowFeet()).toBe(0);
    const tile = new PixelDocument(newDoc('tile', '타일'));
    tile.begin();
    tile.paint(at, 0, 0, 1);
    expect(tile.trimBelowFeet()).toBe(0);
  });
});

describe('자르기', () => {
  it('사각형 밖을 지운다 (한 프레임 또는 모든 프레임)', () => {
    const doc = new PixelDocument(newDoc('tile', '타일'));
    doc.begin();
    doc.paint(at, 0, 0, 1);
    doc.paint(at, 5, 5, 2);
    doc.crop({ x: 4, y: 4, w: 4, h: 4 }, at);
    expect(doc.pick(at, 0, 0)).toBe(0);
    expect(doc.pick(at, 5, 5)).toBe(2);
  });

  it('캐릭터는 크기를 맞추면 잘라 낸 그림을 발밑 가운데에 둔다', () => {
    const doc = new PixelDocument(newDoc('character', '캐릭터'));
    doc.begin();
    doc.resizeCharacter(64);
    doc.paint(at, 10, 20, 1);
    doc.paint(at, 29, 69, 2);
    doc.crop({ x: 10, y: 20, w: 20, h: 50 }, undefined, true);
    // 가로 = max(20, 50/2) = 25, 세로 50
    expect(doc.doc.width).toBe(25);
    expect(doc.doc.height).toBe(50);
    expect(doc.pick(at, 2, 0)).toBe(1);
    expect(doc.pick(at, 21, 49)).toBe(2);
  });

  it('오브젝트는 크기를 맞추면 16px 단위로 올리고 왼쪽 아래에 둔다', () => {
    const doc = new PixelDocument(newDoc('object', '나무', { w: 3, h: 3 }));
    doc.begin();
    doc.paint(at, 20, 40, 1);
    doc.crop({ x: 20, y: 30, w: 18, h: 11 }, undefined, true);
    expect(doc.doc.width).toBe(32);
    expect(doc.doc.height).toBe(16);
    expect(doc.pick(at, 0, 15)).toBe(1);
    expect(doc.doc.footprint).toEqual([1, 1]);
  });
});
