import { type MapDoc, SIDE_SKY, isSideDoc } from '@metacode/client';
import {
  type AssetManifest,
  type AssetRef,
  Cell,
  DEFAULT_ANIMATION,
  type MapLayout,
  TILE_SIZE,
} from '@metacode/shared';
import {
  FilterMode,
  MipmapMode,
  PaintStyle,
  Skia,
  type SkPicture,
} from '@shopify/react-native-skia';
import type { FrameImages } from '../plaza/images';

const T = TILE_SIZE;
const DARK = '#11161d';

export interface MapOverlay {
  /** 막힌 칸(빨강)·발판(노란 윗변) 보기 */
  showBlocked: boolean;
  /** 끄는 중인 스폰 영역 (없으면 문서의 것) */
  spawn: MapDoc['spawn'];
  /** 오브젝트를 놓을 자리 미리보기 (칸 = 그림의 왼쪽 아래) */
  preview: { ref: AssetRef; x: number; y: number } | null;
}

/**
 * 맵 에디터의 맵을 한 장의 Skia 그림으로 (월드 픽셀 단위, 화면 배율은 그리는 쪽에서). 웹 mapCanvas.paintMap과 같은
 * 순서: 탑다운은 바닥 → 장식 → 오브젝트(아래쪽 끝이 앞), 횡스크롤은 하늘 → 바닥 → 오브젝트(배경) → 장식(앞).
 * 에셋은 첫 프레임만 그린다.
 */
export function drawMapPicture(
  doc: MapDoc,
  layout: MapLayout,
  assetOf: (ref: AssetRef) => AssetManifest | undefined,
  frames: FrameImages,
  overlay: MapOverlay,
): SkPicture {
  const width = doc.width * T;
  const height = doc.height * T;
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, width, height));
  const paint = Skia.Paint();
  const fill = (color: string, x: number, y: number, w: number, h: number) => {
    paint.setColor(Skia.Color(color));
    canvas.drawRect(Skia.XYWHRect(x, y, w, h), paint);
  };
  const side = isSideDoc(doc);
  fill(side ? SIDE_SKY : DARK, 0, 0, width, height);
  paint.setColor(Skia.Color('#000000'));

  const drawAsset = (ref: AssetRef, x: number, y: number, alpha = 1) => {
    const manifest = assetOf(ref);
    if (!manifest) return;
    const index = manifest.animations[DEFAULT_ANIMATION]?.frames[0] ?? 0;
    const image = frames.frame(`map:${ref}`, manifest, index);
    if (!image) return;
    paint.setAlphaf(alpha);
    canvas.drawImageRectOptions(
      image,
      Skia.XYWHRect(0, 0, manifest.width, manifest.height),
      Skia.XYWHRect(x, y, manifest.width, manifest.height),
      FilterMode.Nearest,
      MipmapMode.None,
      paint,
    );
    paint.setAlphaf(1);
  };
  const layer = (grid: Uint8Array) =>
    grid.forEach((v, i) => {
      const ref = v > 0 ? doc.tiles[v - 1] : undefined;
      if (ref) drawAsset(ref, (i % doc.width) * T, Math.floor(i / doc.width) * T);
    });
  const objects = () => {
    for (const o of [...doc.objects].sort((a, b) => a.y - b.y)) {
      const manifest = assetOf(o.asset);
      if (manifest) drawAsset(o.asset, o.x * T, (o.y + 1) * T - manifest.height);
    }
  };
  layer(doc.ground);
  if (side) {
    objects();
    layer(doc.overlay);
  } else {
    layer(doc.overlay);
    objects();
  }

  // 막힌 칸 (빨강), 횡스크롤의 발판 (노란 윗변: 위에서만 딛는다)
  if (overlay.showBlocked) {
    layout.blocked.forEach((b, i) => {
      if (!b) return;
      const x = (i % doc.width) * T;
      const y = Math.floor(i / doc.width) * T;
      if (b === Cell.Platform) fill('rgba(253,190,83,0.6)', x, y, T, 4);
      else fill('rgba(232,69,55,0.28)', x, y, T, T);
    });
  }

  // 격자
  const line = Skia.Paint();
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeWidth(0.5);
  line.setColor(Skia.Color('rgba(0,0,0,0.15)'));
  for (let x = 1; x < doc.width; x++) canvas.drawLine(x * T, 0, x * T, height, line);
  for (let y = 1; y < doc.height; y++) canvas.drawLine(0, y * T, width, y * T, line);

  // 스폰 영역 (초록 테두리)
  const spawn = overlay.spawn;
  line.setStrokeWidth(1.5);
  line.setColor(Skia.Color('#3fb950'));
  canvas.drawRect(
    Skia.XYWHRect(spawn.x * T + 1, spawn.y * T + 1, spawn.w * T - 2, spawn.h * T - 2),
    line,
  );

  // 놓을 자리 미리보기
  if (overlay.preview) {
    const { ref, x, y } = overlay.preview;
    const manifest = assetOf(ref);
    if (manifest) drawAsset(ref, x * T, (y + 1) * T - manifest.height, 0.6);
  }

  return recorder.finishRecordingAsPicture();
}
