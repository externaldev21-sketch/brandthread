#!/usr/bin/env node
/**
 * Generates the small icon-sized Thread Cash bill thumbnail from the
 * owner's real thread-cash-bill.png (1200x510): a centered crop that keeps
 * the medallion plus the top/bottom green border (so it still reads as a
 * little rectangular BILL, never a coin), rounded at the corners, exported
 * at @1x/@2x/@3x so Metro's asset pipeline picks the right density
 * automatically.
 *
 * Run after the source art changes:
 *   node scripts/thread-cash/generate-bill-icon.mjs
 */
import sharp from 'sharp';
import path from 'node:path';

const ASSET_DIR = path.resolve(import.meta.dirname, '../../assets/thread-cash');
const SOURCE = path.join(ASSET_DIR, 'thread-cash-bill.png');

// Design size in points; RN resolves name@2x/@3x automatically from these.
const BASE_WIDTH = 28;
const BASE_HEIGHT = 19; // ~1.47:1, close to the crop's own aspect ratio.
const SCALES = [1, 2, 3];

async function run() {
  const meta = await sharp(SOURCE).metadata();
  const { width: srcW, height: srcH } = meta;

  // A centered horizontal slice around the medallion, full height (so the
  // top/bottom green border stays in frame) — wide enough to read as a
  // bill, narrow enough that the wordmarks/corner badges it cuts through
  // don't look like stray artifacts at icon size.
  const cropWidth = Math.round(srcH * (BASE_WIDTH / BASE_HEIGHT));
  const cropLeft = Math.round((srcW - cropWidth) / 2);

  for (const scale of SCALES) {
    const targetW = BASE_WIDTH * scale;
    const targetH = BASE_HEIGHT * scale;
    const radius = Math.round(targetH * 0.16);

    const roundedMask = Buffer.from(
      `<svg width="${targetW}" height="${targetH}"><rect x="0" y="0" width="${targetW}" height="${targetH}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
    );

    const cropped = await sharp(SOURCE)
      .extract({ left: cropLeft, top: 0, width: cropWidth, height: srcH })
      .resize(targetW, targetH, { fit: 'cover' })
      .toBuffer();

    const rounded = await sharp(cropped)
      .composite([{ input: roundedMask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    const suffix = scale === 1 ? '' : `@${scale}x`;
    const outPath = path.join(ASSET_DIR, `thread-cash-bill-icon${suffix}.png`);
    await sharp(rounded).toFile(outPath);
    console.log(`[thread-cash] wrote ${path.relative(process.cwd(), outPath)} (${targetW}x${targetH})`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
