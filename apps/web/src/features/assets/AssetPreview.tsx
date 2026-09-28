import { type AssetManifest, DEFAULT_ANIMATION } from '@metacode/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { frameAt, framePixels } from './render';

/** 목록 카드에 보일 애니메이션: 캐릭터는 아래로 걷기, 나머지는 기본 애니메이션 */
export function previewAnimation(manifest: AssetManifest): string {
  return manifest.kind === 'character' ? 'walk-down' : DEFAULT_ANIMATION;
}

/**
 * 에셋을 도트 그대로 그린다. animate면 애니메이션을 틀고, 아니면 첫 프레임만.
 * palette를 주면 그 색으로 그린다 (캐릭터 색 바꾸기 미리보기).
 *
 * box는 화면에서 차지할 크기(가장 긴 변, px)다. 캐릭터는 해상도가 저마다 다르므로(16×32 ~ 128×256)
 * 배율이 아니라 화면 크기로 받아야 어떤 에셋이든 목록에서 같은 크기로 보인다.
 * 캔버스는 도트 배율(정수)로 그리고, 해상도가 box보다 크면 CSS로 줄인다.
 */
export function AssetPreview({
  manifest,
  box,
  animation = previewAnimation(manifest),
  animate = true,
  palette,
}: {
  manifest: AssetManifest;
  box: number;
  animation?: string;
  animate?: boolean;
  palette?: readonly string[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const longest = Math.max(manifest.width, manifest.height);
  const scale = Math.max(1, Math.floor(box / longest));
  const shown = box / longest;
  // 같은 색이면 같은 배열로 본다 (부르는 쪽이 매번 새 배열을 만들어도 애니메이션이 처음부터 다시 돌지 않게).
  const [stablePalette, setStablePalette] = useState(palette);
  if (palette?.join() !== stablePalette?.join()) setStablePalette(palette);
  const images = useMemo(
    () =>
      manifest.frames.map(
        (_, i) =>
          new ImageData(framePixels(manifest, i, stablePalette), manifest.width, manifest.height),
      ),
    [manifest, stablePalette],
  );

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const buffer = document.createElement('canvas');
    buffer.width = manifest.width;
    buffer.height = manifest.height;
    const bufferCtx = buffer.getContext('2d')!;
    const anim = manifest.animations[animation] ?? Object.values(manifest.animations)[0];
    let shown = -1;
    const draw = (frame: number) => {
      if (frame === shown) return;
      shown = frame;
      const image = images[frame];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!image) return;
      bufferCtx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);
    };
    draw(anim?.frames[0] ?? 0);
    if (!animate || !anim || anim.frames.length < 2) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      draw(frameAt(anim, now - start));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [manifest, images, animation, animate]);

  return (
    <canvas
      ref={ref}
      className="asset-preview"
      width={manifest.width * scale}
      height={manifest.height * scale}
      style={{ width: manifest.width * shown, height: manifest.height * shown }}
      aria-label={manifest.name}
    />
  );
}
