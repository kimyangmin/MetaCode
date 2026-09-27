import { type Direction, type MapLayout, type Obstacle, TILE_SIZE } from '@metacode/shared';
import type { ThemeAppearance } from './themes';

/**
 * 도트 에셋(Phase 6) 전까지 쓰는 플레이스홀더 그림. 캔버스에 픽셀 단위로 그리고,
 * 씬은 이것을 텍스처로 등록해서 쓴다. 에셋이 들어오면 이 파일을 스프라이트시트 로딩으로 바꾼다.
 */

const T = TILE_SIZE;

function canvas(width: number, height: number) {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { el, ctx };
}

function rect(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** 안티앨리어싱 없는 원 (도트 느낌) */
function disc(ctx: CanvasRenderingContext2D, color: string, cx: number, cy: number, r: number) {
  ctx.fillStyle = color;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** 타일 좌표에서 만든 고정 난수 (0 이상 1 미만). 풀 무늬가 매번 같게 나온다 */
function noise(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ── 맵 ──

/** 바닥 한 장: 풀, 길, 광장 바닥, 담장, 그리고 높이가 없는 장애물(분수, 벤치, 통나무, 모닥불 돌) */
export function drawGround(layout: MapLayout, look: ThemeAppearance): HTMLCanvasElement {
  const { el, ctx } = canvas(layout.width * T, layout.height * T);
  rect(ctx, look.ground, 0, 0, el.width, el.height);
  for (let ty = 0; ty < layout.height; ty++) {
    for (let tx = 0; tx < layout.width; tx++) {
      for (let i = 0; i < 3; i++) {
        const n = noise(tx, ty, i);
        if (n < 0.6) {
          rect(
            ctx,
            look.groundSpeckle,
            tx * T + (Math.floor(n * 26) % T),
            ty * T + (Math.floor(n * 97) % T),
            1,
            2,
          );
        }
      }
    }
  }

  for (const d of layout.decorations) {
    const x = d.x * T;
    const y = d.y * T;
    const w = d.w * T;
    const h = d.h * T;
    if (d.kind === 'plaza-floor') {
      rect(ctx, look.plazaFloor, x, y, w, h);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      for (let gx = x; gx < x + w; gx += T) ctx.fillRect(gx, y, 1, h);
      for (let gy = y; gy < y + h; gy += T) ctx.fillRect(x, gy, w, 1);
    } else if (d.kind === 'path') {
      rect(ctx, look.path, x, y, w, h);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.07)';
      for (let py = 0; py < d.h; py++) {
        for (let px = 0; px < d.w; px++) {
          const n = noise(d.x + px, d.y + py, 7);
          ctx.fillRect(
            x + px * T + Math.floor(n * 13),
            y + py * T + (Math.floor(n * 53) % T),
            2,
            1,
          );
        }
      }
    } else {
      // 모닥불 빛: 가운데가 밝은 원
      const gradient = ctx.createRadialGradient(
        x + w / 2,
        y + h / 2,
        0,
        x + w / 2,
        y + h / 2,
        Math.max(w, h) / 2,
      );
      gradient.addColorStop(0, `${look.firelight}66`);
      gradient.addColorStop(1, `${look.firelight}00`);
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, w, h);
    }
  }

  for (const o of layout.obstacles) {
    if (o.kind === 'wall') drawHedge(ctx, o, look);
    else if (o.kind === 'fountain') drawFountain(ctx, o, look);
    else if (o.kind === 'bench') drawBench(ctx, o, look);
    else if (o.kind === 'log') drawLog(ctx, o, look);
    else if (o.kind === 'campfire') drawFireStones(ctx, o, look);
  }
  return el;
}

function drawHedge(ctx: CanvasRenderingContext2D, o: Obstacle, look: ThemeAppearance) {
  rect(ctx, look.wall, o.x * T, o.y * T, o.w * T, o.h * T);
  for (let ty = o.y; ty < o.y + o.h; ty++) {
    for (let tx = o.x; tx < o.x + o.w; tx++) {
      rect(ctx, look.wallTop, tx * T + 1, ty * T + 1, T - 2, 5);
      disc(ctx, look.wallTop, tx * T + 4 + noise(tx, ty) * 8, ty * T + 9, 2.5);
    }
  }
}

function drawFountain(ctx: CanvasRenderingContext2D, o: Obstacle, look: ThemeAppearance) {
  const x = o.x * T;
  const y = o.y * T;
  const w = o.w * T;
  const h = o.h * T;
  rect(ctx, 'rgba(0, 0, 0, 0.18)', x + 2, y + 4, w, h - 2);
  rect(ctx, look.fountainStone, x + 1, y + 1, w - 2, h - 2);
  rect(ctx, 'rgba(255, 255, 255, 0.25)', x + 1, y + 1, w - 2, 2);
  rect(ctx, look.water, x + 5, y + 5, w - 10, h - 10);
  ctx.fillStyle = look.waterLight;
  for (let i = 0; i < 14; i++) {
    const n = noise(o.x, o.y, i);
    ctx.fillRect(
      x + 7 + Math.floor(n * (w - 18)),
      y + 7 + Math.floor(noise(i, o.y) * (h - 16)),
      4,
      1,
    );
  }
  // 가운데 분수대
  const cx = x + w / 2;
  const cy = y + h / 2;
  disc(ctx, look.fountainStone, cx, cy + 2, 7);
  disc(ctx, look.water, cx, cy + 2, 4.5);
  rect(ctx, look.fountainStone, cx - 2, cy - 12, 4, 14);
  disc(ctx, look.waterLight, cx, cy - 13, 3);
}

function drawBench(ctx: CanvasRenderingContext2D, o: Obstacle, look: ThemeAppearance) {
  const x = o.x * T;
  const y = o.y * T;
  const w = o.w * T;
  rect(ctx, 'rgba(0, 0, 0, 0.2)', x + 2, y + 13, w - 2, 3);
  rect(ctx, look.bench, x + 1, y + 2, w - 2, 4);
  rect(ctx, look.bench, x + 1, y + 7, w - 2, 4);
  rect(ctx, 'rgba(255, 255, 255, 0.15)', x + 1, y + 2, w - 2, 1);
  rect(ctx, 'rgba(0, 0, 0, 0.35)', x + 3, y + 11, 2, 3);
  rect(ctx, 'rgba(0, 0, 0, 0.35)', x + w - 5, y + 11, 2, 3);
}

function drawLog(ctx: CanvasRenderingContext2D, o: Obstacle, look: ThemeAppearance) {
  const x = o.x * T;
  const y = o.y * T;
  const w = o.w * T;
  const h = o.h * T;
  rect(ctx, 'rgba(0, 0, 0, 0.2)', x + 2, y + h - 3, w - 2, 3);
  rect(ctx, look.log, x + 1, y + 2, w - 2, h - 4);
  rect(ctx, 'rgba(255, 255, 255, 0.12)', x + 1, y + 2, w - 2, 2);
  const horizontal = w >= h;
  const ringX = horizontal ? x + 1 : x + w / 2 - 3;
  const ringY = horizontal ? y + h / 2 - 3 : y + 2;
  rect(ctx, '#c49a6c', ringX, ringY, 6, 6);
  rect(ctx, look.log, ringX + 2, ringY + 2, 2, 2);
}

function drawFireStones(ctx: CanvasRenderingContext2D, o: Obstacle, look: ThemeAppearance) {
  const cx = (o.x + o.w / 2) * T;
  const cy = (o.y + o.h / 2) * T;
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    disc(ctx, look.fountainStone, cx + Math.cos(angle) * 12, cy + Math.sin(angle) * 10, 3);
  }
  rect(ctx, '#3b2a1c', cx - 8, cy - 6, 16, 12);
  rect(ctx, look.log, cx - 9, cy + 1, 18, 3);
}

/** 높이가 있어 캐릭터를 가릴 수 있는 것들: 나무. 발밑(아래쪽 끝) 기준으로 앞뒤를 정한다 */
export interface Prop {
  key: string;
  canvas: HTMLCanvasElement;
  /** 그림 가운데 아래 (월드 px) */
  x: number;
  y: number;
}

export function drawProps(layout: MapLayout, look: ThemeAppearance): Prop[] {
  const props: Prop[] = [];
  for (const o of layout.obstacles) {
    if (o.kind !== 'tree') continue;
    if (o.w >= 2 && o.h >= 2) {
      props.push({
        key: `tree-${o.x}-${o.y}`,
        canvas: bigTree(look),
        x: (o.x + o.w / 2) * T,
        y: (o.y + o.h) * T,
      });
      continue;
    }
    // 가장자리를 두르는 나무 줄: 칸마다 작은 나무
    for (let ty = o.y; ty < o.y + o.h; ty++) {
      for (let tx = o.x; tx < o.x + o.w; tx++) {
        props.push({
          key: `bush-${tx}-${ty}`,
          canvas: smallTree(look, noise(tx, ty)),
          x: tx * T + T / 2,
          y: (ty + 1) * T,
        });
      }
    }
  }
  return props;
}

function bigTree(look: ThemeAppearance) {
  const { el, ctx } = canvas(40, 52);
  disc(ctx, 'rgba(0, 0, 0, 0.2)', 20, 48, 10);
  rect(ctx, look.treeTrunk, 16, 34, 8, 16);
  disc(ctx, look.treeLeaves, 20, 20, 18);
  disc(ctx, look.treeLeavesLight, 15, 14, 9);
  disc(ctx, look.treeLeaves, 26, 26, 6);
  return el;
}

function smallTree(look: ThemeAppearance, seed: number) {
  const { el, ctx } = canvas(20, 28);
  rect(ctx, look.treeTrunk, 8, 20, 4, 8);
  disc(ctx, look.treeLeaves, 10, 12 + seed * 2, 9.5);
  disc(ctx, look.treeLeavesLight, 7 + seed * 3, 9 + seed * 2, 4);
  return el;
}

/** 모닥불 불꽃 프레임들 (가운데 아래 기준, 16×20) */
export function drawFlames(look: ThemeAppearance): HTMLCanvasElement[] {
  return [0, 1, 2].map((frame) => {
    const { el, ctx } = canvas(16, 20);
    const [outer, inner, core] = look.fire;
    const sway = [0, 1, -1][frame]!;
    disc(ctx, outer, 8, 13, 6);
    disc(ctx, outer, 8 + sway, 8, 4);
    disc(ctx, core, 8 - sway, 13, 3.5);
    disc(ctx, inner, 8 + sway, 12, 3);
    rect(ctx, inner, 7 + sway, 3 + frame, 2, 3);
    return el;
  });
}

// ── 캐릭터 (16×32, 발밑 가운데가 위치) ──

const SHIRTS = [
  '#e5534b',
  '#3f8fdb',
  '#57ab5a',
  '#c69026',
  '#986ee2',
  '#e275ad',
  '#39a6a8',
  '#e0823d',
];
const HAIRS = ['#2b1d14', '#6b4226', '#c9a063', '#1c1c1c', '#8a3b2a'];
const SKIN = '#f1c7a0';
const PANTS = '#34405a';
const SHOES = '#1d1f24';

/** 사용자마다 고정된 옷, 머리 색 */
export function paletteOf(userId: string): { shirt: string; hair: string; key: string } {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (Math.imul(h, 31) + userId.charCodeAt(i)) | 0;
  const shirt = Math.abs(h) % SHIRTS.length;
  const hair = Math.abs(h >> 8) % HAIRS.length;
  return { shirt: SHIRTS[shirt]!, hair: HAIRS[hair]!, key: `char-${shirt}-${hair}` };
}

export function drawCharacter(shirt: string, hair: string, dir: Direction): HTMLCanvasElement {
  const { el, ctx } = canvas(16, 32);
  // 머리
  rect(ctx, SKIN, 4, 7, 8, 9);
  rect(ctx, hair, 3, 4, 10, 4);
  rect(ctx, hair, 4, 3, 8, 1);
  if (dir === 'up') {
    rect(ctx, hair, 3, 8, 10, 7);
  } else if (dir === 'down') {
    rect(ctx, hair, 3, 8, 1, 4);
    rect(ctx, hair, 12, 8, 1, 4);
    rect(ctx, '#2a2320', 6, 11, 1, 2);
    rect(ctx, '#2a2320', 9, 11, 1, 2);
  } else {
    const back = dir === 'left' ? 10 : 3;
    rect(ctx, hair, back, 8, 3, 6);
    rect(ctx, '#2a2320', dir === 'left' ? 5 : 10, 11, 1, 2);
  }
  // 몸
  rect(ctx, shirt, 4, 16, 8, 9);
  rect(ctx, 'rgba(0, 0, 0, 0.18)', 4, 23, 8, 2);
  if (dir === 'left' || dir === 'right') {
    rect(ctx, SKIN, dir === 'left' ? 6 : 8, 19, 2, 5);
  } else {
    rect(ctx, shirt, 3, 17, 1, 6);
    rect(ctx, shirt, 12, 17, 1, 6);
    rect(ctx, SKIN, 3, 23, 1, 2);
    rect(ctx, SKIN, 12, 23, 1, 2);
  }
  // 다리
  rect(ctx, PANTS, 5, 25, 3, 5);
  rect(ctx, PANTS, 8, 25, 3, 5);
  rect(ctx, SHOES, 5, 30, 3, 2);
  rect(ctx, SHOES, 8, 30, 3, 2);
  return el;
}

export function drawShadow(): HTMLCanvasElement {
  const { el, ctx } = canvas(14, 5);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 14; x++) {
      if (((x + 0.5 - 7) / 7) ** 2 + ((y + 0.5 - 2.5) / 2.5) ** 2 <= 1) ctx.fillRect(x, y, 1, 1);
    }
  }
  return el;
}

/** 클릭한 곳 표시 */
export function drawTargetMarker(): HTMLCanvasElement {
  const { el, ctx } = canvas(10, 6);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 10; x++) {
      const d = ((x + 0.5 - 5) / 5) ** 2 + ((y + 0.5 - 3) / 3) ** 2;
      if (d <= 1 && d >= 0.45) ctx.fillRect(x, y, 1, 1);
    }
  }
  return el;
}
