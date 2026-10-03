import {
  CLOUD_VARIANTS,
  type PlazaWorld,
  SIDE_SKY,
  type WorldActor,
  cloudArt,
  frameAt,
  hillsArt,
  shadowArt,
  speakingRingArt,
  targetMarkerArt,
} from '@metacode/client';
import { TILE_SIZE, groundBelow } from '@metacode/shared';
import {
  FilterMode,
  MipmapMode,
  type SkCanvas,
  type SkImage,
  type SkPaint,
  Skia,
} from '@shopify/react-native-skia';
import { type FrameImages, type MapPiece, type MapScene, imageFromArt } from './images';

/**
 * 광장 한 프레임을 Skia 캔버스에 그린다 (웹 PlazaScene의 그리기와 같은 순서·깊이).
 * 탑다운: 바닥 < 장식 < 클릭 표시 < 그림자·고리 < 캐릭터·오브젝트(발밑·아래쪽 끝 y 순서).
 * 횡스크롤: 하늘·구름·언덕 < 바닥 < 오브젝트(배경) < 그림자·고리 < 캐릭터 < 장식(앞에 겹치는 풀).
 */

/** 작은 표시 그림 (광장 화면마다 한 벌) */
export interface PlazaArt {
  shadow: SkImage | null;
  marker: SkImage | null;
  ring: SkImage | null;
  clouds: (SkImage | null)[];
  hills: SkImage | null;
  dispose(): void;
}

export function createPlazaArt(): PlazaArt {
  const art = {
    shadow: imageFromArt(shadowArt()),
    marker: imageFromArt(targetMarkerArt()),
    ring: imageFromArt(speakingRingArt()),
    clouds: Array.from({ length: CLOUD_VARIANTS }, (_, i) => imageFromArt(cloudArt(i))),
    hills: imageFromArt(hillsArt()),
  };
  return {
    ...art,
    dispose() {
      for (const image of [art.shadow, art.marker, art.ring, art.hills, ...art.clouds]) {
        image?.dispose();
      }
    },
  };
}

/** 화면에 그릴 배율과 카메라 (화면 단위 = dp). 배율은 실제 픽셀로 정수가 되게 맞춘 값 */
export interface PlazaView {
  width: number;
  height: number;
  scale: number;
  /** 화면 왼쪽 위에 오는 월드 좌표 */
  left: number;
  top: number;
}

const sky = Skia.Color(SIDE_SKY);
const clear = Skia.Color('#11161d');

/** 이미지를 월드 사각형에 그린다. 도트는 키울 때 가장 가까운 픽셀, 줄일 때(큰 캐릭터)는 부드럽게 */
function drawImage(
  canvas: SkCanvas,
  image: SkImage,
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number,
  paint: SkPaint,
  flip = false,
): void {
  const src = Skia.XYWHRect(0, 0, image.width(), image.height());
  const shrinking = width * scale < image.width();
  const filter = shrinking ? FilterMode.Linear : FilterMode.Nearest;
  const mipmap = shrinking ? MipmapMode.Linear : MipmapMode.None;
  if (!flip) {
    canvas.drawImageRectOptions(
      image,
      src,
      Skia.XYWHRect(x, y, width, height),
      filter,
      mipmap,
      paint,
    );
    return;
  }
  canvas.save();
  canvas.translate(x + width, y);
  canvas.scale(-1, 1);
  canvas.drawImageRectOptions(
    image,
    src,
    Skia.XYWHRect(0, 0, width, height),
    filter,
    mipmap,
    paint,
  );
  canvas.restore();
}

export function drawPlaza(
  canvas: SkCanvas,
  world: PlazaWorld,
  map: MapScene,
  images: FrameImages,
  art: PlazaArt,
  view: PlazaView,
  now: number,
): void {
  const paint = Skia.Paint();
  const { scale } = view;
  canvas.drawColor(map.side ? sky : clear);
  canvas.save();
  canvas.scale(scale, scale);
  canvas.translate(-view.left, -view.top);

  const piece = (p: MapPiece) => {
    const frame = p.animation ? frameAt(p.animation, now) : 0;
    const image = images.frame(p.key, p.manifest, frame);
    if (image)
      drawImage(canvas, image, p.x, p.y, p.manifest.width, p.manifest.height, scale, paint);
  };
  const layer = (image: SkImage | null) => {
    if (image) drawImage(canvas, image, 0, 0, map.width, map.height, scale, paint);
  };

  if (map.side) drawBackdrop(canvas, world, art, view, scale, paint);
  layer(map.ground);
  map.groundTiles.forEach(piece);
  if (!map.side) {
    layer(map.overlay);
    map.overlayTiles.forEach(piece);
  } else {
    map.objects.forEach(piece);
  }

  const actors = [...world.actors.values()];
  // 클릭 표시, 그림자, 말하는 중 고리 (캐릭터보다 뒤)
  const marker = world.marker;
  if (marker && art.marker) {
    drawImage(canvas, art.marker, marker.x - 5, marker.y - 3, 10, 6, scale, paint);
  }
  for (const actor of actors) drawGround(canvas, actor, art, scale, paint, now);

  if (map.side) {
    actors.sort((a, b) => a.position.y - b.position.y);
    for (const actor of actors) drawActor(canvas, actor, images, scale, paint);
    layer(map.overlay);
    map.overlayTiles.forEach(piece);
  } else {
    // 캐릭터(발밑 y)와 오브젝트(아래쪽 끝 y)를 함께 앞뒤로 줄 세운다
    const items: { depth: number; draw(): void }[] = [
      ...actors.map((actor) => ({
        depth: actor.position.y,
        draw: () => drawActor(canvas, actor, images, scale, paint),
      })),
      ...map.objects.map((object) => ({ depth: object.depth, draw: () => piece(object) })),
    ];
    items.sort((a, b) => a.depth - b.depth);
    for (const item of items) item.draw();
  }
  canvas.restore();
  paint.dispose();
}

function drawGround(
  canvas: SkCanvas,
  actor: WorldActor,
  art: PlazaArt,
  scale: number,
  paint: SkPaint,
  now: number,
): void {
  const { x } = actor.position;
  const y = actor.groundY;
  if (art.shadow) {
    paint.setAlphaf(actor.groundAlpha);
    // 웹: 원점 (0.5, 0.6)
    drawImage(canvas, art.shadow, x - 7, y - 3, 14, 5, scale, paint);
  }
  const voice = actor.voice;
  if (art.ring && voice?.speaking && !voice.muted) {
    paint.setAlphaf((0.6 + 0.4 * Math.sin(now / 150)) * actor.groundAlpha);
    drawImage(canvas, art.ring, x - 9, y + 1 - 4.8, 18, 8, scale, paint);
  }
  paint.setAlphaf(1);
}

function drawActor(
  canvas: SkCanvas,
  actor: WorldActor,
  images: FrameImages,
  scale: number,
  paint: SkPaint,
): void {
  const { look, size, pose } = actor;
  const image = images.frame(look.key, look.manifest, pose.frame, look.palette);
  if (!image) return;
  const { x, y } = actor.position;
  drawImage(
    canvas,
    image,
    x - size.width / 2,
    y - actor.lift - size.height,
    size.width,
    size.height,
    scale,
    paint,
    pose.flip,
  );
}

/**
 * 횡스크롤 하늘: 멀리 있는 언덕 띠와 구름 두 겹. 카메라보다 천천히 움직여(패럴랙스) 멀리 있는 것처럼 보이고,
 * 세로로는 따라 움직여 언덕이 땅과 어긋나지 않게 한다 (웹 drawBackdrop과 같은 자리).
 */
function drawBackdrop(
  canvas: SkCanvas,
  world: PlazaWorld,
  art: PlazaArt,
  view: PlazaView,
  scale: number,
  paint: SkPaint,
): void {
  const layout = world.layout;
  if (!layout) return;
  const width = layout.width * TILE_SIZE;
  // 패럴랙스: 월드 x를 카메라가 움직인 만큼의 (1 - 배율)만큼 따라 옮긴다
  const shift = (factor: number) => view.left * (1 - factor);
  const { spawn } = layout;
  const horizonX = (spawn.x + spawn.w / 2) * TILE_SIZE;
  const horizon = groundBelow(layout, horizonX, (spawn.y + 1) * TILE_SIZE - 1);
  const clouds = Math.max(4, Math.round(width / 120));
  const cloud = (i: number) => {
    const image = art.clouds[i % art.clouds.length];
    if (!image) return;
    const far = i % 2 === 0;
    const x = (i + 0.3 + ((i * 7) % 5) / 10) * (width / clouds) + shift(far ? 0.3 : 0.6);
    const y = TILE_SIZE * (1.5 + ((i * 5) % 4) * 1.2);
    paint.setAlphaf(far ? 0.8 : 1);
    const w = image.width();
    const h = image.height();
    drawImage(canvas, image, x - w / 2, y - h / 2, w, h, scale, paint);
  };
  for (let i = 0; i < clouds; i += 2) cloud(i);
  paint.setAlphaf(1);
  if (art.hills) {
    const top = horizon + 8 - 48;
    const offset = shift(0.5);
    for (let x = 0; x < width + 512; x += 192) {
      drawImage(canvas, art.hills, x + offset, top, 192, 48, scale, paint);
    }
  }
  for (let i = 1; i < clouds; i += 2) cloud(i);
  paint.setAlphaf(1);
}
