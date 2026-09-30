import { Canvas, layer, toManifest } from './canvas.mjs';

/**
 * 횡스크롤 광장(옆에서 본 광장)의 타일. Kenney Tiny Town은 위에서 내려다본 타일뿐이라
 * 같은 팔레트로 옆모습을 직접 그린다: 풀 덮인 땅, 흙, 돌바닥, 바위, 나무 상자(지나갈 수 없음),
 * 나무 발판(위에서만 딛음), 흙 벽(배경), 풀·꽃·울타리(장식).
 */
const O = '#3f2631';
const GRASS = { light: '#8bd87d', mid: '#84c669', dark: '#65a556', deep: '#479f4a' };
const DIRT = { light: '#eaa56c', mid: '#cf8254', dark: '#bd6c4a', deep: '#763b36' };
const STONE = { white: '#e9edf5', light: '#c0cbdc', mid: '#8b9bb4', dark: '#5a6988' };
const WOOD = { light: '#eaa56c', mid: '#bd6c4a', dark: '#763b36' };
const FLOWER = { yellow: '#fdbe53', orange: '#e38628', red: '#e84537', white: '#ffffff' };

const still = { default: { frames: [0], frameMs: 1000 } };

/** 흙 단면: 바탕에 작은 돌과 밝은 알갱이. seed로 자리를 바꿔 여러 칸이 똑같아 보이지 않게 한다 */
function dirt(c, top, base, seed) {
  c.rect(0, top, 16, 16 - top, base.mid);
  const pebbles = [
    [3, 9],
    [10, 11],
    [6, 14],
    [13, 7],
    [1, 12],
    [8, 6],
  ];
  const sparks = [
    [7, 10],
    [12, 14],
    [2, 7],
    [14, 12],
  ];
  pebbles.forEach(([x, y], i) => {
    const px = (x + seed * 5) % 16;
    const py = y + ((i + seed) % 2);
    if (py < top || py > 15) return;
    c.set(px, py, base.dark);
    if (i % 2 === 0) c.set((px + 1) % 16, py, base.dark);
  });
  sparks.forEach(([x, y]) => {
    const py = y - seed;
    if (py >= top && py <= 15) c.set((x + seed * 3) % 16, py, base.light);
  });
}

/** 풀 덮인 땅: 위 네 줄은 풀이고 흙 쪽으로 풀이 들쭉날쭉 늘어진다 */
function grassBlock() {
  const c = new Canvas(16, 16);
  dirt(c, 0, DIRT, 0);
  const hang = [2, 1, 0, 1, 2, 3, 1, 0, 0, 1, 2, 1, 0, 2, 1, 0];
  for (let x = 0; x < 16; x++) {
    const depth = 3 + hang[x];
    for (let y = 0; y <= depth; y++) c.set(x, y, GRASS.mid);
    c.set(x, depth, GRASS.dark);
    c.set(x, 0, x % 3 === 1 ? GRASS.mid : GRASS.light);
  }
  for (const [x, y] of [
    [2, 2],
    [7, 1],
    [11, 2],
    [14, 1],
  ]) {
    c.set(x, y, GRASS.dark);
  }
  return c;
}

function dirtBlock() {
  const c = new Canvas(16, 16);
  dirt(c, 0, DIRT, 1);
  return c;
}

/** 흙 벽 (배경): 굴이나 땅속 뒤쪽. 어둡게 그려 앞의 땅과 구별한다 */
function dirtBack() {
  const c = new Canvas(16, 16);
  dirt(c, 0, { light: DIRT.mid, mid: DIRT.dark, dark: DIRT.deep }, 2);
  return c;
}

/** 돌바닥: 엇갈려 쌓은 돌. 맨 윗줄은 밝게 (광장 바닥) */
function stoneBlock() {
  const c = new Canvas(16, 16).rect(0, 0, 16, 16, STONE.light);
  for (let band = 0; band < 4; band++) {
    const y = band * 4;
    c.rect(0, y + 3, 16, 1, STONE.mid);
    const offset = band % 2 === 0 ? 0 : 4;
    for (let x = offset; x < 16; x += 8) c.rect(x, y, 1, 3, STONE.mid);
    // 돌마다 오른쪽 아래 그림자
    for (let x = offset + 7; x < 16 + offset; x += 8) c.set(x % 16, y + 2, STONE.mid);
  }
  c.rect(0, 0, 16, 1, STONE.white);
  return c;
}

/** 바위: 절벽이나 산 */
function rockBlock() {
  const c = new Canvas(16, 16).rect(0, 0, 16, 16, STONE.mid);
  const cracks = [
    [2, 3, 4, 1],
    [9, 6, 5, 1],
    [4, 11, 1, 3],
    [12, 12, 3, 1],
    [7, 1, 1, 2],
  ];
  for (const [x, y, w, h] of cracks) c.rect(x, y, w, h, STONE.dark);
  for (const [x, y] of [
    [3, 2],
    [10, 5],
    [5, 10],
    [13, 11],
    [1, 8],
  ]) {
    c.set(x, y, STONE.light);
  }
  return c;
}

/** 나무 상자: 쌓아서 딛고 올라가는 블록 */
function crate() {
  const c = new Canvas(16, 16).rect(0, 0, 16, 16, WOOD.mid);
  c.rect(0, 0, 16, 2, WOOD.dark).rect(0, 14, 16, 2, WOOD.dark);
  c.rect(0, 0, 2, 16, WOOD.dark).rect(14, 0, 2, 16, WOOD.dark);
  for (let i = 2; i < 14; i++) {
    c.set(i, i, WOOD.dark);
    c.set(i + 1 < 14 ? i + 1 : i, i, WOOD.dark);
  }
  c.rect(2, 2, 12, 1, WOOD.light);
  return c;
}

/** 나무 발판: 위에서 내려오면 딛고, 아래에서는 뛰어올라 지나간다. 윗부분의 얇은 판만 그린다 */
function plank() {
  const c = new Canvas(16, 16).rect(0, 0, 16, 5, WOOD.mid).rect(0, 0, 16, 1, WOOD.light);
  c.rect(0, 4, 16, 1, WOOD.dark).rect(7, 1, 1, 3, WOOD.dark);
  // 못
  c.set(2, 2, O);
  c.set(12, 2, O);
  // 받침
  c.rect(3, 5, 2, 3, WOOD.dark).rect(11, 5, 2, 3, WOOD.dark);
  return c;
}

/** 풀 (장식): 칸 아래쪽에 풀잎. 땅 위 칸에 칠하면 캐릭터 발이 풀에 묻힌다 */
function grassTuft() {
  const c = new Canvas(16, 16);
  const blades = [
    [1, 4, GRASS.dark],
    [3, 6, GRASS.mid],
    [4, 3, GRASS.deep],
    [6, 5, GRASS.mid],
    [9, 7, GRASS.dark],
    [10, 4, GRASS.mid],
    [12, 6, GRASS.light],
    [14, 3, GRASS.dark],
  ];
  for (const [x, h, color] of blades) {
    for (let k = 0; k < h; k++) c.set(x + (k > h / 2 && x % 2 ? 1 : 0), 15 - k, color);
  }
  return c;
}

/** 꽃 (장식) */
function flowers() {
  const c = new Canvas(16, 16);
  for (const [x, top] of [
    [4, 9],
    [11, 7],
  ]) {
    c.rect(x, top + 2, 1, 16 - top - 2, GRASS.deep);
  }
  for (const [x, y] of [
    [5, 13],
    [10, 12],
    [12, 14],
  ]) {
    c.set(x, y, GRASS.mid);
  }
  const bloom = (x, y, petal, core) => {
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      c.set(x + dx, y + dy, petal);
    }
    c.set(x, y, core);
  };
  bloom(4, 9, FLOWER.yellow, FLOWER.orange);
  bloom(11, 7, FLOWER.white, FLOWER.yellow);
  c.set(7, 13, FLOWER.red);
  c.set(8, 14, GRASS.dark);
  return c;
}

/** 울타리 (장식): 기둥 두 개와 가로대 */
function fence() {
  return layer(
    16,
    16,
    (l) => {
      l.rect(2, 5, 3, 11, WOOD.light);
      l.rect(11, 5, 3, 11, WOOD.light);
      l.rect(0, 7, 16, 2, WOOD.light);
      l.rect(0, 12, 16, 2, WOOD.light);
    },
    O,
  );
}

export function sideAssets() {
  const tile = (name, canvas, extra) =>
    toManifest({ kind: 'tile', name, frames: [canvas], animations: still, ...extra });
  return {
    'builtin:side-grass': tile('땅 (풀)', grassBlock(), { solid: true }),
    'builtin:side-dirt': tile('흙', dirtBlock(), { solid: true }),
    'builtin:side-stone': tile('돌바닥', stoneBlock(), { solid: true }),
    'builtin:side-rock': tile('바위', rockBlock(), { solid: true }),
    'builtin:side-crate': tile('나무 상자', crate(), { solid: true }),
    'builtin:side-plank': tile('나무 발판', plank(), { solid: false, platform: true }),
    'builtin:side-dirt-back': tile('흙 벽 (배경)', dirtBack(), { solid: false }),
    'builtin:side-grass-tuft': tile('풀 (장식)', grassTuft(), { solid: false }),
    'builtin:side-flowers': tile('꽃 (장식)', flowers(), { solid: false }),
    'builtin:side-fence': tile('울타리 (장식)', fence(), { solid: false }),
  };
}
