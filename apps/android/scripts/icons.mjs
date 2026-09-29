// 앱 아이콘과 시작 화면을 만든다: 밤하늘 바탕에 도트 모닥불 (MetaCode 팔레트).
//   node apps/android/scripts/icons.mjs
// 만든 파일은 커밋한다. 모양을 바꾸려면 FLAME과 COLORS를 고치고 다시 실행한다.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const RES = join(dirname(fileURLToPath(import.meta.url)), '../android/app/src/main/res');

const NIGHT = '#1B1E30';
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

const write = (path, text) => {
  mkdirSync(dirname(join(RES, path)), { recursive: true });
  writeFileSync(join(RES, path), text);
};

// ── 적응형 아이콘 전경 (108dp, 가운데 66dp가 늘 보이는 곳): 도트 하나 = 5dp, 60dp를 가운데에
const DP = 5;
const OFFSET = (108 - GRID * DP) / 2;
const vector = (size, dp, offset) => {
  const byColor = new Map();
  for (const p of pixels) {
    const d = `M${offset + p.x * dp},${offset + p.y * dp}h${dp}v${dp}h-${dp}z`;
    byColor.set(p.color, (byColor.get(p.color) ?? '') + d);
  }
  const paths = [...byColor]
    .map(([color, d]) => `    <path android:fillColor="${color}" android:pathData="${d}" />`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- scripts/icons.mjs가 만든 파일 -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${size}dp"
    android:height="${size}dp"
    android:viewportWidth="${size}"
    android:viewportHeight="${size}">
${paths}
</vector>
`;
};
write('drawable/ic_launcher_foreground.xml', vector(108, DP, OFFSET));
write(
  'values/ic_launcher_background.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${NIGHT}</color>
</resources>
`,
);
for (const name of ['ic_launcher', 'ic_launcher_round']) {
  write(
    `mipmap-anydpi-v26/${name}.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>
`,
  );
}

// ── 시작 화면: 밤하늘 바탕 가운데에 모닥불 (도트 하나 = 8dp)
write('drawable/splash_fire.xml', vector(GRID * 8, 8, 0));
write(
  'drawable/splash.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<!-- scripts/icons.mjs가 만든 파일 -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/ic_launcher_background" />
    <item
        android:width="${GRID * 8}dp"
        android:height="${GRID * 8}dp"
        android:drawable="@drawable/splash_fire"
        android:gravity="center" />
</layer-list>
`,
);

// ── 안드로이드 7 이하용 PNG 아이콘 (둥근 네모, 원)
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const svg = (size, round) => {
  const cell = (size * 0.62) / GRID;
  const offset = (size - cell * GRID) / 2;
  const rects = pixels
    .map(
      (p) =>
        `<rect x="${offset + p.x * cell}" y="${offset + p.y * cell}" width="${cell + 0.01}" height="${cell + 0.01}" fill="${p.color}"/>`,
    )
    .join('');
  const bg = round
    ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${NIGHT}"/>`
    : `<rect width="${size}" height="${size}" rx="${size * 0.18}" fill="${NIGHT}"/>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" shape-rendering="crispEdges">${bg}${rects}</svg>`,
  );
};
for (const [density, size] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${density}`);
  rmSync(join(dir, 'ic_launcher_foreground.png'), { force: true });
  await sharp(svg(size, false)).png().toFile(join(dir, 'ic_launcher.png'));
  await sharp(svg(size, true)).png().toFile(join(dir, 'ic_launcher_round.png'));
}
console.log('아이콘과 시작 화면을 만들었습니다.');
