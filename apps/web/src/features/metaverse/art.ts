import type { Direction } from '@metacode/shared';

/**
 * 광장의 작은 표시(그림자, 클릭 표시, 말하는 중 고리)와 캐릭터 플레이스홀더.
 * 캔버스에 픽셀 단위로 그리고, 씬은 이것을 텍스처로 등록해서 쓴다.
 */

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

/** 말하는 중 표시: 발밑의 초록 고리 */
export function drawSpeakingRing(): HTMLCanvasElement {
  const { el, ctx } = canvas(18, 8);
  ctx.fillStyle = '#3fb950';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 18; x++) {
      const d = ((x + 0.5 - 9) / 9) ** 2 + ((y + 0.5 - 4) / 4) ** 2;
      if (d <= 1 && d >= 0.5) ctx.fillRect(x, y, 1, 1);
    }
  }
  return el;
}
