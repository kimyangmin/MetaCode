import {
  type AssetManifest,
  type AssetRef,
  DEFAULT_ANIMATION,
  type MapObject,
  PlazaStyle,
  TILE_SIZE,
} from '@metacode/shared';
import { SIDE_SKY } from '../metaverse/art';
import { framePixels } from './render';

const firstFrames = new WeakMap<AssetManifest, HTMLCanvasElement>();

/** 에셋 첫 프레임을 원래 크기 캔버스로 (맵 그리기용, 매니페스트마다 한 번 만든다) */
export function firstFrame(manifest: AssetManifest): HTMLCanvasElement {
  const cached = firstFrames.get(manifest);
  if (cached) return cached;
  const frame = manifest.animations[DEFAULT_ANIMATION]?.frames[0] ?? 0;
  const canvas = document.createElement('canvas');
  canvas.width = manifest.width;
  canvas.height = manifest.height;
  canvas
    .getContext('2d')!
    .putImageData(
      new ImageData(framePixels(manifest, frame), manifest.width, manifest.height),
      0,
      0,
    );
  firstFrames.set(manifest, canvas);
  return canvas;
}

/** 캔버스에 그릴 맵: 격자는 풀어 둔 바이트 배열 (값 v = tiles[v - 1], 0 = 빈칸) */
export interface PaintableMap {
  width: number;
  height: number;
  tiles: AssetRef[];
  ground: Uint8Array;
  overlay: Uint8Array;
  objects: MapObject[];
  style?: PlazaStyle;
}

/** 빈칸의 색: 탑다운은 어두운 바탕, 횡스크롤은 하늘 (광장 화면과 같게) */
export function mapBackground(style: PlazaStyle | undefined): string {
  return style === PlazaStyle.SideScroll ? SIDE_SKY : '#11161d';
}

/**
 * 맵을 캔버스에 그린다 (각 에셋의 첫 프레임). 광장과 같은 순서로 겹친다:
 * 탑다운은 바닥 → 장식 → 오브젝트(아래쪽 끝이 앞), 횡스크롤은 바닥 → 오브젝트(배경) → 장식(앞).
 */
export function paintMap(
  ctx: CanvasRenderingContext2D,
  map: PaintableMap,
  zoom: number,
  assetOf: (ref: AssetRef) => AssetManifest | undefined,
): void {
  const T = TILE_SIZE * zoom;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = mapBackground(map.style);
  ctx.fillRect(0, 0, map.width * T, map.height * T);
  const layer = (grid: Uint8Array) =>
    grid.forEach((v, i) => {
      const manifest = v > 0 ? assetOf(map.tiles[v - 1]!) : undefined;
      if (!manifest) return;
      ctx.drawImage(firstFrame(manifest), (i % map.width) * T, Math.floor(i / map.width) * T, T, T);
    });
  const objects = () => {
    for (const o of [...map.objects].sort((a, b) => a.y - b.y)) {
      const manifest = assetOf(o.asset);
      if (!manifest) continue;
      const bottom = (o.y + 1) * T;
      ctx.drawImage(
        firstFrame(manifest),
        o.x * T,
        bottom - manifest.height * zoom,
        manifest.width * zoom,
        manifest.height * zoom,
      );
    }
  };
  layer(map.ground);
  if (map.style === PlazaStyle.SideScroll) {
    objects();
    layer(map.overlay);
  } else {
    layer(map.overlay);
    objects();
  }
}
