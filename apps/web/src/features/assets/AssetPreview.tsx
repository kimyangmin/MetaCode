import { type AssetManifest, DEFAULT_ANIMATION } from '@metacode/shared';
import { useEffect, useMemo, useRef } from 'react';
import { frameAt, framePixels } from './render';

/** 목록 카드에 보일 애니메이션: 캐릭터는 아래로 걷기, 나머지는 기본 애니메이션 */
export function previewAnimation(manifest: AssetManifest): string {
  return manifest.kind === 'character' ? 'walk-down' : DEFAULT_ANIMATION;
}

/**
 * 에셋을 도트 그대로 키워 그린다. animate면 애니메이션을 틀고, 아니면 첫 프레임만.
 * palette를 주면 그 색으로 그린다 (캐릭터 색 바꾸기 미리보기).
 */
export function AssetPreview({
  manifest,
  scale,
  animation = previewAnimation(manifest),
  animate = true,
  palette,
}: {
  manifest: AssetManifest;
  scale: number;
  animation?: string;
  animate?: boolean;
  palette?: readonly string[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const images = useMemo(
    () =>
      manifest.frames.map(
        (_, i) => new ImageData(framePixels(manifest, i, palette), manifest.width, manifest.height),
      ),
    [manifest, palette],
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
      aria-label={manifest.name}
    />
  );
}
