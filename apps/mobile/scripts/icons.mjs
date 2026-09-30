// 앱 아이콘과 시작 화면 그림을 만든다: 밤하늘 바탕에 도트 모닥불 (MetaCode 팔레트, 예전 Capacitor 앱과 같은 모양).
//   node apps/mobile/scripts/icons.mjs
// 만든 PNG는 커밋한다. Expo가 빌드할 때 이 그림으로 안드로이드 아이콘·시작 화면을 만든다 (app.json).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../assets');

export const NIGHT = '#1B1E30';
const COLORS = {
  1: '#E8503A', // 불꽃 바깥
  2: '#F58D32', // 불꽃
  3: '#FDBE53', // 불꽃 가운데 (모닥불색)
  4: '#8A5A3B', // 장작
  5: '#5E3B25', // 장작 그림자
};
// 12×12 도트. '.'는 비움
const FLAME = [
  '.....1......',
  '....121.....',
  '....1221....',
  '...12221..1.',
  '...122321.1.',
  '..12233211..',
  '.1223333221.',
  '.1233333321.',
  '..12333321..',
  '.4444444444.',
  '.4554455445.',
  '............',
];
const GRID = FLAME.length;

const pixels = [];
FLAME.forEach((row, y) =>
  [...row].forEach((c, x) => {
    if (c !== '.') pixels.push({ x, y, color: COLORS[c] });
  }),
);

/** size 크기 그림 가운데에 모닥불을 ratio만큼 크게 그린다. mono면 흰색 한 가지(알림·테마 아이콘용) */
function svg(size, ratio, { background = null, mono = false } = {}) {
  const cell = Math.floor((size * ratio) / GRID);
  const offset = Math.round((size - cell * GRID) / 2);
  const rects = pixels
    .map(
      (p) =>
        `<rect x="${offset + p.x * cell}" y="${offset + p.y * cell}" width="${cell}" height="${cell}" fill="${mono ? '#FFFFFF' : p.color}"/>`,
    )
    .join('');
  const bg = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" shape-rendering="crispEdges">${bg}${rects}</svg>`,
  );
}

const write = (name, buffer) => sharp(buffer).png().toFile(join(OUT, name));

mkdirSync(OUT, { recursive: true });
// 일반 아이콘 (안드로이드 7 이하, 스토어 목록 등)
await write('icon.png', svg(1024, 0.62, { background: NIGHT }));
// 적응형 아이콘: 108dp 중 가운데 66dp가 늘 보이므로 모닥불을 60/108 크기로
await write('android-icon-foreground.png', svg(1024, 60 / 108));
await write('android-icon-background.png', svg(1024, 0, { background: NIGHT }));
await write('android-icon-monochrome.png', svg(1024, 60 / 108, { mono: true }));
// 시작 화면 가운데 그림 (배경색은 app.json)
await write('splash-icon.png', svg(1024, 1));
console.log('아이콘과 시작 화면 그림을 만들었습니다.');
