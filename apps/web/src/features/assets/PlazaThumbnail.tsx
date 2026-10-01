import { type PlazaMap, TILE_SIZE, decodePixels } from '@metacode/shared';
import { BUILTIN_MAPS, builtinAsset } from '@metacode/shared/builtin-assets';
import { useEffect, useRef } from 'react';
import { paintMap } from './mapCanvas';

/**
 * 내장 광장 맵의 미리보기 (광장 방식 고르기). 맵 전체를 도트 그대로 한 장 그리고,
 * 상자에는 CSS(object-fit: cover)로 가운데를 채워 보여 준다. 내장 에셋을 쓰므로 따로 불러온다(lazy).
 */
export default function PlazaThumbnail({ map }: { map: PlazaMap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const definition = BUILTIN_MAPS[map];

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const cells = definition.width * definition.height;
    paintMap(
      canvas.getContext('2d')!,
      {
        ...definition,
        ground: decodePixels(definition.ground) ?? new Uint8Array(cells),
        overlay: decodePixels(definition.overlay) ?? new Uint8Array(cells),
      },
      1,
      builtinAsset,
    );
  }, [definition]);

  return (
    <canvas
      ref={ref}
      className="plaza-thumbnail"
      width={definition.width * TILE_SIZE}
      height={definition.height * TILE_SIZE}
      aria-hidden
    />
  );
}
