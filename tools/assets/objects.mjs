import { Canvas, layer, toManifest } from './canvas.mjs';

/**
 * Kenney Tiny Town에 없는 것들을 같은 팔레트로 직접 그린다: 분수, 모닥불, 벤치, 통나무, 나무, 가로등, 물.
 * 외곽선은 Kenney와 같은 #3f2631.
 */
const O = '#3f2631';
const STONE = { light: '#c0cbdc', mid: '#8b9bb4', dark: '#5a6988' };
const WATER = { mid: '#009adc', light: '#76e4ff', white: '#ffffff' };
const WOOD = { light: '#eaa56c', mid: '#bd6c4a', dark: '#763b36' };
const LEAF = { light: '#84c669', mid: '#65a556', dark: '#479f4a' };
const FIRE = { yellow: '#fdbe53', orange: '#e38628', red: '#e84537', edge: '#c34b35' };

const still = { default: { frames: [0], frameMs: 1000 } };
const loop = (count, frameMs) => ({
  default: { frames: Array.from({ length: count }, (_, i) => i), frameMs },
});

/** 분수 (3×4타일). 물줄기와 물결이 4프레임으로 움직인다. 아래 세 줄이 막힌다 */
function fountainFrame(f) {
  const c = new Canvas(48, 64);
  // 수반: 앞쪽 벽(원통 옆면) + 위쪽 테두리
  c.draw(
    layer(
      48,
      64,
      (l) => {
        l.ellipse(24, 51, 23, 11, STONE.mid);
        l.rect(1, 40, 46, 11, STONE.mid);
        l.ellipse(24, 40, 23, 11, STONE.light);
      },
      O,
    ),
  );
  // 앞쪽 벽의 돌 이음매
  for (let x = 6; x < 44; x += 8) {
    for (let y = 47; y < 60; y++)
      if (c.get(x, y) === STONE.mid && c.get(x, y + 1)) c.set(x, y, STONE.dark);
  }
  for (let x = 2; x < 46; x++) if (c.get(x, 53) === STONE.mid) c.set(x, 53, STONE.dark);
  // 물
  c.ellipse(24, 40, 20, 8.5, O);
  c.ellipse(24, 40, 19, 7.5, WATER.mid);
  // 물결: 프레임마다 옆으로 흐른다
  const ripples = [
    [10, 38],
    [30, 36],
    [16, 43],
    [34, 42],
    [22, 45],
  ];
  ripples.forEach(([x, y], i) => {
    const dx = ((f + i) % 4) - 1;
    for (let k = 0; k < 3; k++) {
      if (c.get(x + dx + k, y) === WATER.mid) c.set(x + dx + k, y, WATER.light);
    }
  });
  // 가운데 기둥과 윗접시
  c.draw(
    layer(
      48,
      64,
      (l) => {
        l.rect(21, 22, 6, 18, STONE.mid);
        l.rect(22, 22, 2, 18, STONE.light);
        l.ellipse(24, 38, 5, 2.5, STONE.mid);
        l.ellipse(24, 21, 9, 3.5, STONE.light);
      },
      O,
    ),
  );
  c.ellipse(24, 20.5, 6, 1.8, WATER.mid);
  // 솟는 물줄기
  for (let y = 5; y < 20; y++) {
    c.set(23, y, WATER.light);
    c.set(24, y, y % 3 === f % 3 ? WATER.white : WATER.light);
  }
  c.set(23, 4, WATER.white);
  c.set(24, 4, WATER.white);
  // 양옆으로 떨어지는 물방울 (프레임마다 아래로)
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const t = (f + k * 4) / 12;
      const x = 24 + side * Math.round(3 + t * 9);
      const y = Math.round(8 + t * 26 + t * t * 6);
      if (y < 34) c.set(side < 0 ? x - 1 : x, y, k === 0 ? WATER.white : WATER.light);
    }
  }
  return c;
}

/** 모닥불 (2×3타일): 돌 둘레, 장작, 3프레임 불꽃. 아래 한 줄이 막힌다 */
function campfireFrame(f) {
  const c = new Canvas(32, 48);
  const cx = 16;
  const cy = 39;
  const stones = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    return { x: cx + Math.cos(a) * 12, y: cy + Math.sin(a) * 5.5, back: Math.sin(a) < 0 };
  });
  const stone = (s) =>
    c.draw(
      layer(
        32,
        48,
        (l) =>
          l
            .ellipse(s.x, s.y, 3.2, 2.4, STONE.mid)
            .ellipse(s.x - 0.5, s.y - 0.8, 1.6, 1, STONE.light),
        O,
      ),
    );
  stones.filter((s) => s.back).forEach(stone);
  // 재와 장작
  c.ellipse(cx, cy, 9, 3.5, '#262b44');
  c.draw(
    layer(
      32,
      48,
      (l) => {
        l.rect(7, 37, 18, 4, WOOD.mid);
        l.rect(7, 37, 18, 1, WOOD.light);
      },
      O,
    ),
  );
  c.draw(
    layer(
      32,
      48,
      (l) => {
        l.rect(12, 34, 8, 8, WOOD.dark);
        l.rect(13, 34, 6, 1, WOOD.mid);
      },
      O,
    ),
  );
  // 불꽃: 바깥 빨강 → 주황 → 노랑. 끝의 높이와 기울기가 프레임마다 바뀐다
  const sway = [0, 1, -1][f];
  const tips = [
    [
      [11, 22],
      [16, 14],
      [21, 20],
    ],
    [
      [10, 21],
      [17, 13],
      [22, 22],
    ],
    [
      [11, 20],
      [15, 15],
      [21, 21],
    ],
  ][f];
  const flame = layer(
    32,
    48,
    (l) => {
      l.ellipse(16, 32, 7, 6, FIRE.red);
      for (const [tx, ty] of tips) {
        for (let y = ty; y < 32; y++) {
          const w = Math.max(0.6, ((y - ty) / (32 - ty)) * 3.5);
          l.ellipse(tx + ((32 - y) / 32) * sway * 2, y, w, 0.7, FIRE.red);
        }
      }
    },
    FIRE.edge,
  );
  c.draw(flame);
  c.ellipse(16 + sway * 0.5, 32, 4.5, 4, FIRE.orange);
  for (let y = 20 + f; y < 32; y++)
    c.ellipse(16 + ((32 - y) / 12) * sway, y, ((y - 18) / 14) * 2.5, 0.6, FIRE.orange);
  c.ellipse(16, 33, 2.5, 2.5, FIRE.yellow);
  for (let y = 25 + f; y < 33; y++) c.set(15 + (y % 2 ? 0 : sway > 0 ? 1 : 0), y, FIRE.yellow);
  // 불똥
  c.set(10 + f * 5, 10 + ((f * 7) % 5), FIRE.yellow);
  c.set(20 - f * 3, 7 + f * 2, FIRE.orange);
  stones.filter((s) => !s.back).forEach(stone);
  return c;
}

function bench() {
  return layer(
    32,
    32,
    (l) => {
      l.rect(3, 14, 26, 4, WOOD.mid);
      l.rect(3, 14, 26, 1, WOOD.light);
      l.rect(1, 20, 30, 5, WOOD.mid);
      l.rect(1, 20, 30, 1, WOOD.light);
      l.rect(3, 18, 3, 2, WOOD.dark);
      l.rect(26, 18, 3, 2, WOOD.dark);
      l.rect(3, 25, 3, 5, WOOD.dark);
      l.rect(26, 25, 3, 5, WOOD.dark);
    },
    O,
  );
}

function logHorizontal() {
  const c = layer(32, 16, (l) => l.rect(1, 3, 30, 11, WOOD.mid).rect(1, 3, 30, 3, WOOD.light), O);
  c.draw(
    layer(
      32,
      16,
      (l) => l.ellipse(26, 8.5, 4.5, 5.5, WOOD.light).ellipse(26, 8.5, 2, 2.5, WOOD.mid),
      O,
    ),
  );
  return c;
}

function logVertical() {
  const c = layer(16, 32, (l) => l.rect(3, 1, 10, 30, WOOD.mid).rect(3, 1, 3, 30, WOOD.light), O);
  c.draw(
    layer(16, 32, (l) => l.ellipse(8, 25, 5, 5, WOOD.light).ellipse(8, 25, 2.2, 2.2, WOOD.mid), O),
  );
  return c;
}

/** 큰 나무 (2×3타일). 밑동 두 칸이 막힌다 */
function bigTree() {
  const c = new Canvas(32, 48);
  c.draw(layer(32, 48, (l) => l.rect(12, 30, 8, 16, WOOD.dark).rect(13, 30, 2, 16, WOOD.mid), O));
  c.draw(
    layer(
      32,
      48,
      (l) => {
        l.ellipse(16, 20, 15, 13, LEAF.dark);
        l.ellipse(9, 24, 8, 8, LEAF.dark);
        l.ellipse(23, 24, 8, 8, LEAF.dark);
        l.ellipse(15, 16, 11, 10, LEAF.mid);
        l.ellipse(12, 12, 6, 5, LEAF.light);
        l.ellipse(22, 20, 4, 3, LEAF.light);
        l.ellipse(8, 22, 3, 2.5, LEAF.light);
      },
      O,
    ),
  );
  return c;
}

/** 뾰족한 나무 (1×2타일) */
function pine() {
  const c = new Canvas(16, 32);
  c.draw(layer(16, 32, (l) => l.rect(6, 24, 4, 7, WOOD.dark), O));
  c.draw(
    layer(
      16,
      32,
      (l) => {
        for (const [top, bottom, half] of [
          [2, 12, 4],
          [8, 19, 6],
          [14, 26, 7.5],
        ]) {
          for (let y = top; y < bottom; y++) {
            const w = ((y - top) / (bottom - top)) * half + 1;
            l.rect(Math.round(8 - w), y, Math.round(w * 2), 1, LEAF.mid);
          }
        }
        for (let y = 4; y < 24; y += 5) l.rect(6, y, 2, 2, LEAF.light);
      },
      O,
    ),
  );
  return c;
}

/** 가로등 (1×2타일). 아래 칸이 막힌다 */
function lamp() {
  const c = new Canvas(16, 32);
  c.draw(layer(16, 32, (l) => l.rect(7, 9, 2, 20, STONE.dark).rect(5, 27, 6, 4, STONE.dark), O));
  c.draw(layer(16, 32, (l) => l.rect(4, 1, 8, 9, STONE.dark).rect(3, 1, 10, 2, STONE.dark), O));
  c.rect(5, 4, 6, 4, FIRE.yellow).rect(6, 4, 2, 2, '#ffffff');
  return c;
}

/** 물 타일: 4프레임 물결. 칸 경계에서 이어지도록 무늬가 한 칸 안에서 되돌아온다 */
function waterFrame(f) {
  const c = new Canvas(16, 16).rect(0, 0, 16, 16, WATER.mid);
  for (const [x, y] of [
    [2, 3],
    [9, 6],
    [4, 11],
    [12, 13],
  ]) {
    for (let k = 0; k < 3; k++) c.set((x + f + k) % 16, y, WATER.light);
  }
  c.set((6 + f * 3) % 16, 1, WATER.white);
  return c;
}

export function drawnAssets() {
  return {
    'builtin:fountain': toManifest({
      kind: 'object',
      name: '분수',
      frames: [0, 1, 2, 3].map(fountainFrame),
      animations: loop(4, 160),
      footprint: [0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1],
    }),
    'builtin:campfire': toManifest({
      kind: 'object',
      name: '모닥불',
      frames: [0, 1, 2].map(campfireFrame),
      animations: loop(3, 140),
      footprint: [0, 0, 0, 0, 1, 1],
    }),
    'builtin:bench': toManifest({
      kind: 'object',
      name: '벤치',
      frames: [bench()],
      animations: still,
      footprint: [0, 0, 1, 1],
    }),
    'builtin:log': toManifest({
      kind: 'object',
      name: '통나무 (가로)',
      frames: [logHorizontal()],
      animations: still,
      footprint: [1, 1],
    }),
    'builtin:log-vertical': toManifest({
      kind: 'object',
      name: '통나무 (세로)',
      frames: [logVertical()],
      animations: still,
      footprint: [1, 1],
    }),
    'builtin:big-tree': toManifest({
      kind: 'object',
      name: '큰 나무',
      frames: [bigTree()],
      animations: still,
      footprint: [0, 0, 0, 0, 1, 1],
    }),
    'builtin:pine': toManifest({
      kind: 'object',
      name: '뾰족한 나무',
      frames: [pine()],
      animations: still,
      footprint: [0, 1],
    }),
    'builtin:lamp': toManifest({
      kind: 'object',
      name: '가로등',
      frames: [lamp()],
      animations: still,
      footprint: [0, 1],
    }),
    'builtin:water': toManifest({
      kind: 'tile',
      name: '물',
      frames: [0, 1, 2, 3].map(waterFrame),
      animations: loop(4, 300),
      solid: true,
    }),
  };
}
