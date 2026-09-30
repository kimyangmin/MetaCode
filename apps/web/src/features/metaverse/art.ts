/**
 * 광장의 작은 표시: 그림자, 클릭 표시, 말하는 중 고리.
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

// ── 횡스크롤 하늘 ──

/** 횡스크롤 광장의 하늘색 (카메라 배경) */
export const SIDE_SKY = '#9fd8f5';

/** 픽셀 가운데가 타원 안이면 칠한다 */
function fillEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** 뭉게구름 세 가지 (흰 몸통, 아래쪽 옅은 그림자) */
export function drawCloud(variant: number): HTMLCanvasElement {
  const shapes = [
    {
      w: 40,
      h: 16,
      puffs: [
        [12, 9, 9, 6],
        [22, 7, 9, 7],
        [30, 10, 8, 5],
      ],
    },
    {
      w: 56,
      h: 20,
      puffs: [
        [12, 13, 10, 6],
        [24, 9, 11, 9],
        [38, 11, 10, 7],
        [47, 14, 8, 5],
      ],
    },
    {
      w: 32,
      h: 12,
      puffs: [
        [10, 7, 8, 5],
        [21, 6, 8, 5],
      ],
    },
  ] as const;
  const shape = shapes[variant % shapes.length]!;
  const { el, ctx } = canvas(shape.w, shape.h);
  ctx.fillStyle = '#dcecf7';
  for (const [cx, cy, rx, ry] of shape.puffs) fillEllipse(ctx, cx, cy + 1, rx, ry);
  ctx.fillStyle = '#ffffff';
  for (const [cx, cy, rx, ry] of shape.puffs) fillEllipse(ctx, cx, cy - 0.5, rx - 0.5, ry - 1);
  return el;
}

/** 멀리 보이는 언덕 띠 (가로로 이어 붙여도 이어지게 폭 안에서 한 바퀴 도는 물결) */
export function drawHills(): HTMLCanvasElement {
  const width = 192;
  const height = 48;
  const { el, ctx } = canvas(width, height);
  const layers = [
    { color: '#c6e6c0', base: 18, amp: [9, 4], freq: [1, 3] },
    { color: '#acd8a0', base: 30, amp: [6, 3], freq: [2, 5] },
  ];
  for (const layer of layers) {
    ctx.fillStyle = layer.color;
    for (let x = 0; x < width; x++) {
      const t = (x / width) * Math.PI * 2;
      const top = Math.round(
        layer.base +
          layer.amp[0]! * Math.sin(t * layer.freq[0]!) +
          layer.amp[1]! * Math.sin(t * layer.freq[1]! + 1),
      );
      ctx.fillRect(x, top, 1, height - top);
    }
  }
  return el;
}
