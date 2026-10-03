import {
  type AssetAnimation,
  type AssetManifest,
  DEFAULT_ANIMATION,
  type MapDefinition,
  PlazaStyle,
  TILE_SIZE,
  decodePixels,
  mapStyle,
  objectBounds,
} from '@metacode/shared';
import { type AssetLookup, type PixelArt, framePixels, isAnimated } from '@metacode/client';
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';

/** RGBA 픽셀을 Skia 이미지로 (GPU에 올리는 것은 처음 그릴 때) */
export function imageFromRgba(
  width: number,
  height: number,
  rgba: Uint8ClampedArray | Uint8Array,
): SkImage | null {
  const bytes = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return Skia.Image.MakeImage(
    { width, height, alphaType: AlphaType.Unpremul, colorType: ColorType.RGBA_8888 },
    Skia.Data.fromBytes(bytes),
    width * 4,
  );
}

export const imageFromArt = (art: PixelArt) => imageFromRgba(art.width, art.height, art.data);

/**
 * 에셋 프레임 이미지 모음. 키(캐릭터는 색까지 넣은 겉모습 키, 타일·오브젝트는 참조 + 매니페스트 번호)마다
 * 프레임을 처음 그릴 때 만든다. 광장 화면 하나가 하나를 갖고, 화면을 닫으면 버린다.
 */
export class FrameImages {
  private readonly sets = new Map<string, (SkImage | null | undefined)[]>();

  frame(
    key: string,
    manifest: AssetManifest,
    index: number,
    palette: readonly string[] = manifest.palette,
  ): SkImage | null {
    let set = this.sets.get(key);
    if (!set) {
      set = [];
      this.sets.set(key, set);
    }
    let image = set[index];
    if (image === undefined) {
      image = imageFromRgba(manifest.width, manifest.height, framePixels(manifest, index, palette));
      set[index] = image;
    }
    return image;
  }

  dispose(): void {
    for (const set of this.sets.values()) for (const image of set) image?.dispose();
    this.sets.clear();
  }
}

/** 움직이는 타일 하나, 또는 오브젝트 하나 (프레임마다 애니메이션 프레임을 골라 그린다) */
export interface MapPiece {
  key: string;
  manifest: AssetManifest;
  animation: AssetAnimation | undefined;
  /** 그림의 왼쪽 위 (월드 px) */
  x: number;
  y: number;
  /** 앞뒤를 정하는 값: 탑다운은 아래쪽 끝 y, 층 타일은 층 순서 */
  depth: number;
}

/**
 * 맵 그리기 준비 (웹 MapView와 같은 나눔): 정지 타일은 층(바닥, 장식)마다 이미지 한 장으로 합치고,
 * 움직이는 타일과 오브젝트는 따로 두어 프레임마다 고른다.
 */
export interface MapScene {
  side: boolean;
  width: number;
  height: number;
  ground: SkImage | null;
  overlay: SkImage | null;
  /** 층 위의 움직이는 타일 (층별) */
  groundTiles: MapPiece[];
  overlayTiles: MapPiece[];
  objects: MapPiece[];
  dispose(): void;
}

const pieceKey = (ref: string, manifestId: number) => `asset:${ref}:${manifestId}`;

export function buildMapScene(
  map: MapDefinition,
  assetOf: AssetLookup,
  idOf: (manifest: AssetManifest) => number,
): MapScene {
  const side = mapStyle(map) === PlazaStyle.SideScroll;
  const width = map.width * TILE_SIZE;
  const height = map.height * TILE_SIZE;
  const layer = (name: 'ground' | 'overlay', tiles: MapPiece[]) => {
    const grid = decodePixels(map[name]);
    if (!grid) return null;
    const T = TILE_SIZE;
    const out = new Uint8ClampedArray(width * height * 4);
    const resolved = map.tiles.map((ref) => {
      const manifest = assetOf(ref);
      if (!manifest) return null;
      const animation = manifest.animations[DEFAULT_ANIMATION];
      return { ref, manifest, animation, pixels: framePixels(manifest, animation?.frames[0] ?? 0) };
    });
    let painted = false;
    grid.forEach((value, i) => {
      const tile = value > 0 ? resolved[value - 1] : null;
      if (!tile) return;
      const tx = (i % map.width) * T;
      const ty = Math.floor(i / map.width) * T;
      if (isAnimated(tile.animation)) {
        tiles.push({
          key: pieceKey(tile.ref, idOf(tile.manifest)),
          manifest: tile.manifest,
          animation: tile.animation,
          x: tx,
          y: ty,
          depth: 0,
        });
        return;
      }
      // 투명한 픽셀은 아래 층이 보이도록 건너뛴다.
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          const from = (y * T + x) * 4;
          if (tile.pixels[from + 3] === 0) continue;
          out.set(tile.pixels.subarray(from, from + 4), ((ty + y) * width + tx + x) * 4);
        }
      }
      painted = true;
    });
    return painted ? imageFromRgba(width, height, out) : null;
  };

  const groundTiles: MapPiece[] = [];
  const overlayTiles: MapPiece[] = [];
  const ground = layer('ground', groundTiles);
  const overlay = layer('overlay', overlayTiles);
  const objects: MapPiece[] = [];
  for (const object of map.objects) {
    const manifest = assetOf(object.asset);
    if (!manifest) continue;
    const bounds = objectBounds(manifest, object);
    objects.push({
      key: pieceKey(object.asset, idOf(manifest)),
      manifest,
      animation: manifest.animations[DEFAULT_ANIMATION],
      x: bounds.left,
      y: bounds.bottom - manifest.height,
      depth: bounds.bottom,
    });
  }
  // 오브젝트끼리는 아래쪽 끝이 앞
  objects.sort((a, b) => a.depth - b.depth);
  return {
    side,
    width,
    height,
    ground,
    overlay,
    groundTiles,
    overlayTiles,
    objects,
    dispose() {
      ground?.dispose();
      overlay?.dispose();
    },
  };
}
