import sharp from 'sharp';
import { Canvas, toManifest } from './canvas.mjs';

/**
 * 16x16 base sprites (OpenGameArt, CC0)의 옷 없는 몸(18×36, 행 = 아래·위·왼쪽·오른쪽, 열 = 대기 1 + 걷기 6)에
 * 머리와 옷을 입혀 16×32 캐릭터를 만든다.
 *
 * - 몸은 밝은 면(.), 그림자(+), 외곽선(#) 세 색이라 부위별로 [밝은 면, 그림자, 외곽선]으로 바꿔 칠한다.
 * - 16×32에 맞추려고 프레임마다 머리의 겹치는 줄 하나(맨 위 + 4)와 다리 줄 하나(맨 아래 - 6)를 뺀다.
 */
const SRC_W = 18;
const SRC_H = 36;
const SHADE = { ffe6e2: 0, d6a1b2: 1, '996b88': 2 };
const EYE = { '0f0814': 'dark', 314829: 'dark', b5ee2d: 'dark', ffffff: 'white' };
const DIRS = ['down', 'up', 'left', 'right'];

/** 기본 색. 사용자는 부위마다 색 하나를 고르고, 나머지 두 색은 colorRamp로 만든다 */
export const DEFAULT_COLORS = {
  skin: ['#fcbc8f', '#d9926a', '#8a4b3c'],
  hair: ['#763b36', '#57282c', '#3f2631'],
  shirt: ['#e84537', '#b8323a', '#6b1f2e'],
  pants: ['#5a6988', '#414d6b', '#262b44'],
  shoes: ['#4b3a35', '#382a29', '#221a1c'],
};
const EYE_COLORS = { dark: '#1d1a2b', white: '#ffffff' };
const SLOTS = ['skin', 'hair', 'shirt', 'pants', 'shoes'];

function readFrame(data, width, row, col) {
  const cells = [];
  for (let y = 0; y < SRC_H; y++) {
    const line = [];
    for (let x = 0; x < SRC_W; x++) {
      const i = ((row * SRC_H + y) * width + col * SRC_W + x) * 4;
      if (data[i + 3] < 128) {
        line.push(null);
        continue;
      }
      const hex = [data[i], data[i + 1], data[i + 2]]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
      line.push(hex in SHADE ? { shade: SHADE[hex] } : { eye: EYE[hex] ?? 'dark' });
    }
    cells.push(line);
  }
  return cells;
}

/** 이 픽셀이 어느 부위인지. top/bottom은 이 프레임의 그림 위·아래 끝 */
function partOf(dir, style, x, y, top, lowest) {
  const r = y - top;
  const side = dir === 'left' || dir === 'right';
  if (r <= 9) {
    // 머리: 정수리와 앞머리, 방향에 따라 옆머리·뒷머리
    if (r <= 2) return 'hair';
    if (dir === 'up') return r <= 8 ? 'hair' : 'skin';
    if (dir === 'down') {
      if (r === 3) return 'hair';
      const edge = x <= 6 || x >= 11;
      return edge && r <= (style === 'long' ? 9 : 6) ? 'hair' : 'skin';
    }
    if (r === 3) return 'hair';
    const back = dir === 'left' ? x >= 10 : x <= 7;
    return back && r <= (style === 'long' ? 9 : 7) ? 'hair' : 'skin';
  }
  if (style === 'long' && dir === 'up' && r <= 12 && x >= 6 && x <= 11) return 'hair';
  if (y >= lowest[x] - 2) return 'shoes';
  const hips = side ? 20 : 21;
  if (r < hips) {
    // 앞·뒤 모습에서 몸통 바깥의 아래쪽 끝은 손
    if (!side && r >= 17 && (x < 5 || x > 12)) return 'hand';
    return 'shirt';
  }
  return 'pants';
}

function dress(cells, dir, style, colors) {
  let top = SRC_H;
  let bottom = -1;
  cells.forEach((line, y) =>
    line.forEach((cell) => {
      if (!cell) return;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }),
  );
  // 열마다 가장 아래 픽셀 (신발 = 발끝에서 세 줄)
  const lowest = Array.from({ length: SRC_W }, (_, x) => {
    for (let y = SRC_H - 1; y >= 0; y--) if (cells[y][x]) return y;
    return -99;
  });
  const skip = new Set([top + 4, bottom - 6]);
  const out = new Canvas(16, 32);
  let outY = -1;
  for (let y = 0; y < SRC_H; y++) {
    if (skip.has(y)) continue;
    for (let x = 1; x < 17; x++) {
      const cell = cells[y][x];
      if (!cell) continue;
      const part = cell.eye ? null : partOf(dir, style, x, y, top, lowest);
      // 손은 몇 픽셀뿐이라 외곽선 색이면 검게 보인다: 한 단계 밝게 칠한다.
      const color = cell.eye
        ? EYE_COLORS[cell.eye]
        : part === 'hand'
          ? colors.skin[Math.max(0, cell.shade - 1)]
          : colors[part][cell.shade];
      out.set(x - 1, outY, color);
    }
    outY++;
  }
  return out;
}

/**
 * 첨부 모션: 앞을 보고 한 손을 들어 흔든다 (두 프레임). 오른쪽 팔(그림 기준)을 지우고
 * 어깨에서 머리 옆으로 올린 팔을 그린다. 위로 뛰는 움직임은 광장이 따로 준다.
 */
function wave(idle, colors, frame) {
  const c = idle.copy();
  for (let y = 10; y < 22; y++) for (let x = 12; x < 16; x++) c.set(x, y, null);
  const [light, shade, outline] = colors.shirt;
  const [skin, skinShade, skinOutline] = colors.skin;
  const handX = frame === 0 ? 13 : 14;
  // 소매: 어깨(12, 11)에서 손 아래까지 대각선으로
  const sleeve = [
    [12, 11],
    [12, 10],
    [13, 9],
    [13, 8],
    [handX, 7],
  ];
  for (const [x, y] of sleeve) {
    c.set(x - 1, y, outline);
    c.set(x, y, light);
    c.set(x + 1, y, shade);
    c.set(x + 2, y, outline);
  }
  c.set(12, 12, outline);
  // 손
  c.set(handX, 4, skinOutline);
  c.set(handX + 1, 4, skinOutline);
  c.set(handX - 1, 5, skinOutline);
  c.set(handX, 5, skin);
  c.set(handX + 1, 5, skinShade);
  c.set(handX + 2, 5, skinOutline);
  c.set(handX - 1, 6, skinOutline);
  c.set(handX, 6, skin);
  c.set(handX + 1, 6, skin);
  c.set(handX + 2, 6, skinOutline);
  return c;
}

async function character(file, style, name) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const frames = [];
  const animations = {};
  DIRS.forEach((dir, row) => {
    const start = frames.length;
    for (let col = 0; col < 7; col++) {
      frames.push(dress(readFrame(data, info.width, row, col), dir, style, DEFAULT_COLORS));
    }
    animations[`idle-${dir}`] = { frames: [start], frameMs: 1000 };
    animations[`walk-${dir}`] = { frames: [1, 2, 3, 4, 5, 6].map((i) => start + i), frameMs: 100 };
  });
  const idle = frames[animations['idle-down'].frames[0]];
  const emoteStart = frames.length;
  frames.push(wave(idle, DEFAULT_COLORS, 0), wave(idle, DEFAULT_COLORS, 1));
  animations.emote = {
    frames: [emoteStart, emoteStart + 1, emoteStart, emoteStart + 1, emoteStart],
    frameMs: 140,
  };

  const palette = SLOTS.flatMap((slot) => DEFAULT_COLORS[slot]);
  const colorSlots = Object.fromEntries(
    SLOTS.map((slot, i) => [slot, [i * 3 + 1, i * 3 + 2, i * 3 + 3]]),
  );
  return toManifest({ kind: 'character', name, frames, animations, palette, colorSlots });
}

export async function baseCharacters(dir) {
  return {
    'builtin:char-short': await character(`${dir}/base_male.png`, 'short', '짧은 머리'),
    'builtin:char-long': await character(`${dir}/base_female.png`, 'long', '긴 머리'),
  };
}
