import {
  type AssetAnimation,
  type AssetManifest,
  type AssetRef,
  DEFAULT_ANIMATION,
  type MapDefinition,
  TILE_SIZE,
  decodePixels,
  objectBounds,
} from '@metacode/shared';
import type Phaser from 'phaser';
import { frameAt, framePixels, isAnimated, sheetCanvas } from '../assets/render';

export type AssetLookup = (ref: AssetRef) => AssetManifest | undefined;

/** 에셋 하나 = 텍스처 하나. 프레임 i가 텍스처의 프레임 i다 */
export function ensureAssetTexture(
  scene: Phaser.Scene,
  key: string,
  manifest: AssetManifest,
  palette?: readonly string[],
): string {
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.addCanvas(key, sheetCanvas(manifest, palette))!;
  manifest.frames.forEach((_, i) => {
    texture.add(i, 0, i * manifest.width, 0, manifest.width, manifest.height);
  });
  return key;
}

interface AnimatedPiece {
  image: Phaser.GameObjects.Image;
  animation: AssetAnimation;
  shown: number;
}

/** 층 깊이: 바닥 < 움직이는 바닥 타일 < 장식 < 움직이는 장식 타일 < (클릭 표시, 그림자, 캐릭터·오브젝트는 발밑 y) */
const LAYER_DEPTH = { ground: 0, overlay: 0.2 } as const;

let mapCount = 0;

/**
 * 맵 정의를 씬에 그린다. 정지 타일은 층마다 캔버스 한 장으로 합치고, 움직이는 타일과 오브젝트는
 * 따로 두어 tick()에서 프레임을 바꾼다. 오브젝트는 아래쪽 끝(y)으로 캐릭터와 앞뒤를 정한다.
 */
export class MapView {
  private readonly pieces: Phaser.GameObjects.Image[] = [];
  private readonly animated: AnimatedPiece[] = [];
  private readonly canvasKeys: string[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    map: MapDefinition,
    assetOf: AssetLookup,
  ) {
    const id = ++mapCount;
    for (const layer of ['ground', 'overlay'] as const) this.drawLayer(map, layer, assetOf, id);
    for (const object of map.objects) {
      const manifest = assetOf(object.asset);
      if (!manifest) continue;
      const key = ensureAssetTexture(scene, `asset:${object.asset}`, manifest);
      const animation = manifest.animations[DEFAULT_ANIMATION];
      const bounds = objectBounds(manifest, object);
      const image = scene.add
        .image(bounds.left, bounds.bottom, key, animation?.frames[0] ?? 0)
        .setOrigin(0, 1)
        .setDepth(bounds.bottom);
      this.pieces.push(image);
      if (animation && isAnimated(animation)) this.animate(image, animation);
    }
  }

  private drawLayer(
    map: MapDefinition,
    layer: 'ground' | 'overlay',
    assetOf: AssetLookup,
    id: number,
  ) {
    const grid = decodePixels(map[layer]);
    if (!grid) return;
    const T = TILE_SIZE;
    const width = map.width * T;
    const image = new ImageData(width, map.height * T);
    const tiles = map.tiles.map((ref) => {
      const manifest = assetOf(ref);
      if (!manifest) return null;
      const animation = manifest.animations[DEFAULT_ANIMATION];
      return {
        ref,
        manifest,
        animation,
        pixels: framePixels(manifest, animation?.frames[0] ?? 0),
      };
    });
    let painted = false;
    grid.forEach((value, i) => {
      const tile = value > 0 ? tiles[value - 1] : null;
      if (!tile) return;
      const tx = (i % map.width) * T;
      const ty = Math.floor(i / map.width) * T;
      if (tile.animation && isAnimated(tile.animation)) {
        const key = ensureAssetTexture(this.scene, `asset:${tile.ref}`, tile.manifest);
        const piece = this.scene.add
          .image(tx, ty, key, tile.animation.frames[0])
          .setOrigin(0, 0)
          .setDepth(LAYER_DEPTH[layer] + 0.1);
        this.pieces.push(piece);
        this.animate(piece, tile.animation);
        return;
      }
      // 투명한 픽셀은 아래 층이 보이도록 건너뛴다.
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          const from = (y * T + x) * 4;
          if (tile.pixels[from + 3] === 0) continue;
          const to = ((ty + y) * width + tx + x) * 4;
          image.data.set(tile.pixels.subarray(from, from + 4), to);
        }
      }
      painted = true;
    });
    if (!painted) return;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')!.putImageData(image, 0, 0);
    const key = `map-${id}-${layer}`;
    this.scene.textures.addCanvas(key, canvas);
    this.canvasKeys.push(key);
    this.pieces.push(this.scene.add.image(0, 0, key).setOrigin(0, 0).setDepth(LAYER_DEPTH[layer]));
  }

  private animate(image: Phaser.GameObjects.Image, animation: AssetAnimation) {
    this.animated.push({ image, animation, shown: animation.frames[0]! });
  }

  /** 움직이는 타일과 오브젝트의 프레임을 맞춘다. 모두 같은 시계를 써서 물결이 함께 움직인다 */
  tick(now: number): void {
    for (const piece of this.animated) {
      const frame = frameAt(piece.animation, now);
      if (frame === piece.shown) continue;
      piece.shown = frame;
      piece.image.setFrame(frame);
    }
  }

  destroy(): void {
    for (const piece of this.pieces) piece.destroy();
    for (const key of this.canvasKeys) {
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    }
  }
}
