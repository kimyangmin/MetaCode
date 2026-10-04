import { paletteColors } from '@metacode/client';
import type { SkImage } from '@shopify/react-native-skia';
import { imageFromRgba } from '../plaza/images';

/**
 * 에디터 프레임(팔레트 값 Uint16Array) → Skia 이미지. PixelDocument는 고칠 때 프레임을 복사해 바꿔 끼우므로
 * (copy-on-write) 배열 자체를 키로 기억하면 바뀐 프레임만 다시 만든다. 팔레트가 바뀌면 모두 버린다.
 */
export class EditorFrameImages {
  private images = new WeakMap<Uint16Array, SkImage | null>();
  private paletteKey = '';

  image(
    pixels: Uint16Array,
    width: number,
    height: number,
    palette: readonly string[],
  ): SkImage | null {
    const key = palette.join();
    if (key !== this.paletteKey) {
      this.paletteKey = key;
      this.images = new WeakMap();
    }
    let image = this.images.get(pixels);
    if (image === undefined) {
      const colorOf = paletteColors(palette);
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const color = colorOf(pixels[i] ?? 0);
        if (!color) continue;
        rgba[i * 4] = color[0];
        rgba[i * 4 + 1] = color[1];
        rgba[i * 4 + 2] = color[2];
        rgba[i * 4 + 3] = 255;
      }
      image = imageFromRgba(width, height, rgba);
      this.images.set(pixels, image);
    }
    return image;
  }
}
