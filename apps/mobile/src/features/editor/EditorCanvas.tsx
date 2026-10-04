import type { SkImage } from '@shopify/react-native-skia';
import {
  Canvas,
  FilterMode,
  Group,
  Image,
  Line,
  MipmapMode,
  Rect,
  vec,
} from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '../../ui/theme';
import { CanvasGestures } from './canvasGestures';

/**
 * 도트 에디터의 그림판: 지금 프레임을 화면에 맞춰 정수배로 키워 그리고(투명은 체크무늬), 한 손가락으로 칠하고
 * 두 손가락으로 확대·이동한다. 칠하기는 픽셀 좌표로 넘긴다 (onStroke: 시작·이어서·끝).
 * 아래 그림(onion)이 있으면 반투명으로 먼저 그린다 (앞 프레임 겹쳐 보기).
 */
export function EditorCanvas({
  image,
  onion,
  width,
  height,
  grid,
  footprint,
  onStroke,
}: {
  image: SkImage | null;
  onion: SkImage | null;
  /** 그림 크기 (픽셀) */
  width: number;
  height: number;
  /** 타일 칸 선 (16px마다): 오브젝트·타일 */
  grid: boolean;
  /** 오브젝트의 막힌 칸 (가로 칸 수, 칸마다 1/0). 있으면 빨갛게 덮는다 */
  footprint?: { columns: number; cells: readonly number[] } | null;
  onStroke(phase: 'start' | 'move' | 'end', x: number, y: number): void;
}) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // 화면에 들어가는 가장 큰 크기 × 확대 (정수배는 아니어도 Nearest로 그려 도트가 번지지 않음)
  const fit = size.width > 0 ? Math.min(size.width / width, size.height / height) * 0.92 : 1;
  const cell = fit * zoom;
  const drawW = width * cell;
  const drawH = height * cell;
  const left = (size.width - drawW) / 2 + pan.x;
  const top = (size.height - drawH) / 2 + pan.y;

  // 제스처는 한 번만 만들고 지금 값은 CanvasGestures가 든다 (canvasGestures.ts)
  const [controls] = useState(() => new CanvasGestures());
  useEffect(() => {
    controls.sync({ left, top, cell, zoom, pan }, onStroke, setZoom, setPan);
  }, [controls, left, top, cell, zoom, pan, onStroke]);

  const checker = Math.max(4, cell);
  const checkers: { x: number; y: number }[] = [];
  if (size.width > 0 && checker * 2 > 0) {
    const cols = Math.ceil(drawW / checker);
    const rows = Math.ceil(drawH / checker);
    if (cols * rows <= 4096) {
      for (let r = 0; r < rows; r++) {
        for (let c = r % 2; c < cols; c += 2) checkers.push({ x: c * checker, y: r * checker });
      }
    }
  }
  const lines: number[] = [];
  if (grid) for (let i = 16; i < Math.max(width, height); i += 16) lines.push(i);

  return (
    <GestureDetector gesture={controls.gesture}>
      <View
        style={[styles.root, { backgroundColor: theme.bgRail }]}
        onLayout={(e) => setSize(e.nativeEvent.layout)}
      >
        <Canvas style={StyleSheet.absoluteFill}>
          <Group
            transform={[{ translateX: left }, { translateY: top }]}
            clip={{ x: 0, y: 0, width: drawW, height: drawH }}
          >
            <Rect x={0} y={0} width={drawW} height={drawH} color="#ffffff" />
            {checkers.map((c) => (
              <Rect
                key={`${c.x},${c.y}`}
                x={c.x}
                y={c.y}
                width={checker}
                height={checker}
                color="#e6e9ee"
              />
            ))}
            {onion && (
              <Image
                image={onion}
                x={0}
                y={0}
                width={drawW}
                height={drawH}
                opacity={0.3}
                sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }}
              />
            )}
            {image && (
              <Image
                image={image}
                x={0}
                y={0}
                width={drawW}
                height={drawH}
                sampling={{ filter: FilterMode.Nearest, mipmap: MipmapMode.None }}
              />
            )}
            {footprint &&
              footprint.cells.map((blocked, i) =>
                blocked ? (
                  <Rect
                    key={i}
                    x={(i % footprint.columns) * 16 * cell}
                    y={Math.floor(i / footprint.columns) * 16 * cell}
                    width={16 * cell}
                    height={16 * cell}
                    color="rgba(207,34,46,0.28)"
                  />
                ) : null,
              )}
            {lines.map((i) => (
              <Group key={i}>
                {i < width && (
                  <Line
                    p1={vec(i * cell, 0)}
                    p2={vec(i * cell, drawH)}
                    color="rgba(0,0,0,0.25)"
                    strokeWidth={1}
                  />
                )}
                {i < height && (
                  <Line
                    p1={vec(0, i * cell)}
                    p2={vec(drawW, i * cell)}
                    color="rgba(0,0,0,0.25)"
                    strokeWidth={1}
                  />
                )}
              </Group>
            ))}
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
});
