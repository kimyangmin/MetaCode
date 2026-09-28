/** 빌드 스크립트용 작은 도트 캔버스. 픽셀은 '#rrggbb' 또는 null(투명) */
export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.px = new Array(width * height).fill(null);
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.px[y * this.width + x];
  }

  set(x, y, color) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.px[y * this.width + x] = color;
  }

  rect(x, y, w, h, color) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, color);
    return this;
  }

  /** 픽셀 가운데가 타원 안이면 칠한다 (안티앨리어싱 없음) */
  ellipse(cx, cy, rx, ry, color) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) this.set(x, y, color);
      }
    }
    return this;
  }

  /** 가장자리 픽셀(상하좌우 중 하나가 투명)을 외곽선 색으로 바꾼다 */
  outline(color) {
    const edges = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.get(x, y)) continue;
        if (
          !this.get(x - 1, y) ||
          !this.get(x + 1, y) ||
          !this.get(x, y - 1) ||
          !this.get(x, y + 1)
        ) {
          edges.push([x, y]);
        }
      }
    }
    for (const [x, y] of edges) this.set(x, y, color);
    return this;
  }

  /** 다른 캔버스를 (dx, dy)에 겹친다. 투명 픽셀은 건너뛴다 */
  draw(other, dx = 0, dy = 0) {
    for (let y = 0; y < other.height; y++) {
      for (let x = 0; x < other.width; x++) {
        const c = other.get(x, y);
        if (c) this.set(x + dx, y + dy, c);
      }
    }
    return this;
  }

  /** 이 색인 픽셀만 바꾼다 */
  recolor(from, to) {
    this.px = this.px.map((c) => (c === from ? to : c));
    return this;
  }

  copy() {
    const c = new Canvas(this.width, this.height);
    c.px = [...this.px];
    return c;
  }

  mirror() {
    const c = new Canvas(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) c.set(this.width - 1 - x, y, this.get(x, y));
    }
    return c;
  }
}

/** 새 캔버스에 그리고, 그 층만 외곽선을 친 뒤 돌려준다 */
export function layer(width, height, paint, outline) {
  const c = new Canvas(width, height);
  paint(c);
  if (outline) c.outline(outline);
  return c;
}

function encode(values) {
  return Buffer.from(Uint8Array.from(values)).toString('base64');
}

/**
 * 캔버스 프레임들을 에셋 매니페스트로. palette를 주면 그 순서를 앞에 두고(색 부위용),
 * 나머지 색은 처음 나온 순서로 붙인다.
 */
export function toManifest({ kind, name, frames, animations, palette = [], ...rest }) {
  const colors = [...palette];
  // 색 부위(palette)끼리 같은 색이 있으면 한쪽 색을 바꿀 때 다른 쪽도 바뀐다.
  if (new Set(colors).size !== colors.length)
    throw new Error(`${name}: palette에 같은 색이 있습니다`);
  for (const frame of frames) {
    for (const c of frame.px) if (c && !colors.includes(c)) colors.push(c);
  }
  if (colors.length > 64) throw new Error(`${name}: 색이 64개를 넘습니다 (${colors.length})`);
  const { width, height } = frames[0];
  return {
    kind,
    name,
    width,
    height,
    palette: colors,
    frames: frames.map((f) => encode(f.px.map((c) => (c ? colors.indexOf(c) + 1 : 0)))),
    animations,
    ...rest,
  };
}
