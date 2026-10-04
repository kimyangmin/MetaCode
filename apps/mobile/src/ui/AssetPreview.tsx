import { characterPose } from '@metacode/client';
import type { AssetManifest, Direction } from '@metacode/shared';
import { Canvas, FilterMode, Group, Image, MipmapMode } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { FrameImages } from '../features/plaza/images';

/**
 * 에셋 미리보기 (웹 AssetPreview의 휴대폰판): 애니메이션 하나를 되풀이해 틀고, 가장 긴 변이 box(dp)에
 * 들어가게 키운다 (도트는 가장 가까운 픽셀로, 큰 그림은 부드럽게 줄임). 캐릭터 애니메이션은 광장과 같은 규칙으로
 * 고르고 뒤집는다 (횡스크롤용의 왼쪽은 오른쪽 반전 등).
 */
export function AssetPreview({
  manifest,
  box,
  animation = 'default',
  dir = 'down',
  palette,
}: {
  manifest: AssetManifest;
  box: number;
  animation?: string;
  dir?: Direction;
  palette?: readonly string[];
}) {
  const [images] = useState(() => new FrameImages());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => () => images.dispose(), [images]);

  // 프레임이 바뀌는 간격으로만 다시 그린다
  const frameMs = manifest.animations[animation]?.frameMs ?? 200;
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), frameMs);
    return () => clearInterval(timer);
  }, [frameMs, manifest, animation]);

  const pose =
    manifest.kind === 'character'
      ? characterPose(manifest, animation, dir, elapsed)
      : {
          frame: (() => {
            const anim = manifest.animations[animation];
            if (!anim) return 0;
            return anim.frames[Math.floor(elapsed / anim.frameMs) % anim.frames.length] ?? 0;
          })(),
          flip: false,
        };
  // 색을 바꾼 캐릭터는 색마다 그림이 다르므로 팔레트를 키에 넣는다
  const key = `preview:${palette ? palette.join() : ''}`;
  const image = images.frame(key, manifest, pose.frame, palette ?? manifest.palette);
  const scale = box / Math.max(manifest.width, manifest.height);
  const width = manifest.width * scale;
  const height = manifest.height * scale;
  const shrinking = scale < 1;
  return (
    <Canvas style={{ width: box, height: box }}>
      {image && (
        <Group transform={pose.flip ? [{ translateX: box }, { scaleX: -1 }] : []}>
          <Image
            image={image}
            x={(box - width) / 2}
            y={box - height}
            width={width}
            height={height}
            sampling={{
              filter: shrinking ? FilterMode.Linear : FilterMode.Nearest,
              mipmap: shrinking ? MipmapMode.Linear : MipmapMode.None,
            }}
          />
        </Group>
      )}
    </Canvas>
  );
}
