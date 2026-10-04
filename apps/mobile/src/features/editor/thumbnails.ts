import { framePixels } from '@metacode/client';
import { type AssetManifest, DEFAULT_ANIMATION } from '@metacode/shared';
import { FilterMode, MipmapMode, Skia } from '@shopify/react-native-skia';
import { imageFromRgba } from '../plaza/images';

const cache = new WeakMap<AssetManifest, string | null>();

/**
 * 에셋 첫 프레임의 작은 그림 (맵 에디터 팔레트). 칸마다 Skia 캔버스를 두면 무거워서, 도트가 번지지 않게 정수배로
 * 키운 PNG를 한 번 만들어 `data:` 주소로 쓴다. 매니페스트마다 한 번.
 */
export function thumbnailUri(manifest: AssetManifest, box = 40): string | null {
  const cached = cache.get(manifest);
  if (cached !== undefined) return cached;
  const index = manifest.animations[DEFAULT_ANIMATION]?.frames[0] ?? 0;
  const image = imageFromRgba(manifest.width, manifest.height, framePixels(manifest, index));
  const scale = Math.max(1, Math.floor(box / Math.max(manifest.width, manifest.height)));
  const width = manifest.width * scale;
  const height = manifest.height * scale;
  const surface = image ? Skia.Surface.Make(width, height) : null;
  let uri: string | null = null;
  if (image && surface) {
    surface
      .getCanvas()
      .drawImageRectOptions(
        image,
        Skia.XYWHRect(0, 0, manifest.width, manifest.height),
        Skia.XYWHRect(0, 0, width, height),
        FilterMode.Nearest,
        MipmapMode.None,
        Skia.Paint(),
      );
    uri = `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64()}`;
  }
  image?.dispose();
  surface?.dispose();
  cache.set(manifest, uri);
  return uri;
}
