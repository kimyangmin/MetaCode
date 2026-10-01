import { type AssetManifest, DEFAULT_ANIMATION } from '@metacode/shared';
import { useEffect, useRef, useState } from 'react';
import { frameAt, framePixels } from './render';

/** 목록 카드에 보일 애니메이션: 캐릭터는 아래로 걷기, 나머지는 기본 애니메이션 */
export function previewAnimation(manifest: AssetManifest): string {
  return manifest.kind === 'character' ? 'walk-down' : DEFAULT_ANIMATION;
}

/**
 * 미리보기용으로 그린 프레임 (매니페스트·색·프레임·크기마다 한 번). 같은 에셋이 여러 곳에 보여도
 * 다시 그리지 않고, 매니페스트가 버려지면 함께 버려진다.
 */
const drawn = new WeakMap<AssetManifest, Map<string, HTMLCanvasElement>>();

/**
 * 프레임 한 장을 width×height 캔버스로. 원래보다 작게 그릴 때는 부드럽게 줄이고(큰 캐릭터),
 * 같거나 크게 그릴 때는 도트 그대로 키운다.
 */
function frameCanvas(
  manifest: AssetManifest,
  frame: number,
  palette: readonly string[] | undefined,
  width: number,
  height: number,
): HTMLCanvasElement {
  let cache = drawn.get(manifest);
  if (!cache) {
    cache = new Map();
    drawn.set(manifest, cache);
  }
  const key = `${palette?.join() ?? ''}|${frame}|${width}x${height}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const source = document.createElement('canvas');
  source.width = manifest.width;
  source.height = manifest.height;
  source
    .getContext('2d')!
    .putImageData(
      new ImageData(framePixels(manifest, frame, palette), manifest.width, manifest.height),
      0,
      0,
    );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const shrinking = width < manifest.width;
  ctx.imageSmoothingEnabled = shrinking;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  cache.set(key, canvas);
  return canvas;
}

/**
 * 에셋을 도트 그대로 그린다. animate면 애니메이션을 틀고, 아니면 첫 프레임만.
 * palette를 주면 그 색으로 그린다 (캐릭터 색 바꾸기 미리보기).
 *
 * box는 화면에서 차지할 크기(가장 긴 변, px)다. 캐릭터는 해상도가 저마다 다르므로(16×16 ~ 512×512)
 * 배율이 아니라 화면 크기로 받아야 어떤 에셋이든 목록에서 같은 크기로 보인다.
 * 보여 줄 애니메이션의 프레임만, 보이는 크기로 그린다: 예전엔 모든 프레임을 원래 해상도로 풀어 두어서
 * 512×512 캐릭터가 여러 개 보이는 목록이 메모리를 많이 썼다.
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
  const shown = box / longest;
  // 작은 에셋은 도트 배율(정수)로 그리고 CSS로 맞춘다. 큰 에셋은 보이는 크기로 줄여 그린다.
  const scale = longest > box ? shown : Math.max(1, Math.floor(box / longest));
  const width = Math.max(1, Math.round(manifest.width * scale));
  const height = Math.max(1, Math.round(manifest.height * scale));
  // 같은 색이면 같은 배열로 본다 (부르는 쪽이 매번 새 배열을 만들어도 애니메이션이 처음부터 다시 돌지 않게).
  const [stablePalette, setStablePalette] = useState(palette);
  if (palette?.join() !== stablePalette?.join()) setStablePalette(palette);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const anim = manifest.animations[animation] ?? Object.values(manifest.animations)[0];
    let shownFrame = -1;
    const draw = (frame: number) => {
      if (frame === shownFrame) return;
      shownFrame = frame;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (frame >= manifest.frames.length) return;
      ctx.drawImage(frameCanvas(manifest, frame, stablePalette, width, height), 0, 0);
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
  }, [manifest, stablePalette, animation, animate, width, height]);

  return (
    <canvas
      ref={ref}
      className="asset-preview"
      width={width}
      height={height}
      style={{ width: manifest.width * shown, height: manifest.height * shown }}
      aria-label={manifest.name}
    />
  );
}
