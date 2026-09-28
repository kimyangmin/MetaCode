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
