/**
 * Demo product photography for store screenshots.
 *
 * Everything is derived from Brandthread's own generated artwork in
 * attached_assets/generated_images (no stock or third-party photos), by
 * cropping and re-colouring in a headless browser canvas. The result is a
 * small, consistent catalogue: several hoodie colourways, a track jacket,
 * cargo pants, a runner and full-look editorial shots.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE_DIR = path.resolve(import.meta.dirname, '../../../../attached_assets/generated_images');

const SOURCES = {
  hoodie: 'apparel_mockup.png',
  model: 'streetwear_model.png',
  texture: 'abstract_texture.jpg',
};

// crop: [x, y, size] in the 1024×1024 source; filter: CSS canvas filter.
export const DEMO_IMAGES = {
  'hoodie-ember': { source: 'hoodie', crop: [96, 40, 944], filter: 'none' },
  'hoodie-graphite': { source: 'hoodie', crop: [96, 40, 944], filter: 'grayscale(1) contrast(1.08) brightness(1.08)' },
  'hoodie-moss': { source: 'hoodie', crop: [96, 40, 944], filter: 'hue-rotate(55deg) saturate(0.55) brightness(1.05)' },
  'hoodie-midnight': { source: 'hoodie', crop: [96, 40, 944], filter: 'hue-rotate(185deg) saturate(0.6) brightness(1.02)' },
  'hoodie-bone': { source: 'hoodie', crop: [96, 40, 944], filter: 'grayscale(1) invert(0.86) contrast(0.92) brightness(1.02)' },
  'jacket-rust': { source: 'model', crop: [236, 150, 560], filter: 'none' },
  'jacket-onyx': { source: 'model', crop: [236, 150, 560], filter: 'grayscale(1) contrast(1.12)' },
  'cargo-rust': { source: 'model', crop: [250, 420, 580], filter: 'none' },
  'runner-rust': { source: 'model', crop: [0, 660, 380], filter: 'saturate(1.1)' },
  'runner-stone': { source: 'model', crop: [0, 660, 380], filter: 'grayscale(0.9) brightness(1.12)' },
  'look-rust': { source: 'model', crop: [0, 0, 1024], filter: 'none' },
  'look-mono': { source: 'model', crop: [0, 0, 1024], filter: 'grayscale(1) contrast(1.05)' },
  'portrait-rust': { source: 'model', crop: [380, 40, 280], filter: 'none' },
  'portrait-mono': { source: 'model', crop: [380, 40, 280], filter: 'grayscale(1)' },
  'texture-ember': { source: 'texture', crop: [0, 0, 1024], filter: 'none' },
  'texture-mono': { source: 'texture', crop: [0, 0, 1024], filter: 'grayscale(1) brightness(0.9)' },
};

const OUTPUT_SIZE = 900;

function dataUrl(file) {
  const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
  return `data:image/${ext};base64,${readFileSync(file).toString('base64')}`;
}

/**
 * Renders every demo image to `outDir` (skipping ones already there) and
 * returns a map of name → file path. Missing source artwork falls back to a
 * neutral gradient so the script never fails for lack of an image.
 */
export async function ensureDemoImages(browser, outDir) {
  mkdirSync(outDir, { recursive: true });
  const files = Object.fromEntries(Object.keys(DEMO_IMAGES).map((name) => [name, path.join(outDir, `${name}.jpg`)]));
  const missing = Object.keys(DEMO_IMAGES).filter((name) => !existsSync(files[name]));
  if (missing.length === 0) return files;

  const sources = {};
  for (const [key, file] of Object.entries(SOURCES)) {
    const full = path.join(SOURCE_DIR, file);
    sources[key] = existsSync(full) ? dataUrl(full) : null;
  }

  const page = await browser.newPage();
  try {
    for (const name of missing) {
      const recipe = DEMO_IMAGES[name];
      const base64 = await page.evaluate(async ({ src, crop, filter, size }) => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!src) {
          const gradient = ctx.createLinearGradient(0, 0, size, size);
          gradient.addColorStop(0, '#2a2a2e');
          gradient.addColorStop(1, '#0c0c0e');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, size, size);
        } else {
          const img = new Image();
          img.src = src;
          await img.decode();
          ctx.filter = filter;
          const [x, y, side] = crop;
          ctx.drawImage(img, x, y, side, side, 0, 0, size, size);
        }
        return canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
      }, { src: sources[recipe.source], crop: recipe.crop, filter: recipe.filter, size: OUTPUT_SIZE });
      writeFileSync(files[name], Buffer.from(base64, 'base64'));
    }
  } finally {
    await page.close();
  }
  return files;
}
