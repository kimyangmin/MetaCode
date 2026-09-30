/**
 * 내장 에셋을 만든다: assets/vendor의 CC0 원본 + tools/assets에서 직접 그린 것
 *   → packages/shared/src/assets/builtin/assets.json (에셋 매니페스트 형식, 커밋한다)
 *
 *   pnpm assets:build
 *   pnpm assets:build --preview <폴더>   # 확인용 확대 PNG도 만든다
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { baseCharacters } from './assets/characters.mjs';
import { drawnAssets } from './assets/objects.mjs';
import { sideAssets } from './assets/side.mjs';
import { kenneyTiles } from './assets/tiles.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'packages/shared/src/assets/builtin/assets.json');

const assets = {
  ...(await kenneyTiles(join(root, 'assets/vendor/kenney-tiny-town/tilemap_packed.png'))),
  ...drawnAssets(),
  ...sideAssets(),
  ...(await baseCharacters(join(root, 'assets/vendor/base-sprites'))),
};

await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(assets)}\n`);
console.log(`${Object.keys(assets).length}개 → ${out}`);

const previewAt = process.argv.indexOf('--preview');
if (previewAt !== -1) await preview(process.argv[previewAt + 1] ?? 'asset-preview');

/** 에셋마다 모든 프레임을 가로로 늘어놓고 4배로 키운 PNG */
async function preview(dir) {
  await mkdir(dir, { recursive: true });
  const scale = 4;
  for (const [ref, manifest] of Object.entries(assets)) {
    if (ref.startsWith('builtin:tt-')) continue;
    const { width, height, palette, frames } = manifest;
    const sheet = Buffer.alloc(width * frames.length * height * 4);
    frames.forEach((encoded, f) => {
      const pixels = Buffer.from(encoded, 'base64');
      pixels.forEach((v, i) => {
        if (!v) return;
        const hex = palette[v - 1];
        const x = f * width + (i % width);
        const y = Math.floor(i / width);
        const o = (y * width * frames.length + x) * 4;
        sheet[o] = parseInt(hex.slice(1, 3), 16);
        sheet[o + 1] = parseInt(hex.slice(3, 5), 16);
        sheet[o + 2] = parseInt(hex.slice(5, 7), 16);
        sheet[o + 3] = 255;
      });
    });
    await sharp(sheet, { raw: { width: width * frames.length, height, channels: 4 } })
      .resize(width * frames.length * scale, height * scale, { kernel: 'nearest' })
      .flatten({ background: '#84c669' })
      .png()
      .toFile(join(dir, `${ref.slice('builtin:'.length)}.png`));
  }
  console.log(`미리보기 → ${dir}`);
}
