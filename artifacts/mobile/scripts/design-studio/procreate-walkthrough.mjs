/**
 * procreate-walkthrough.mjs — creates a whole design in the Design Studio by
 * actually drawing it (real touch input at 390×844), then exports it and
 * puts it on a garment mockup. Captures the PR screenshots and FAILS if any
 * step doesn't do what it should:
 *
 *   gallery → New canvas (Apparel Print 4500×5400 @300dpi) → Brushes panel →
 *   sketch with 6B Pencil (Size HUD mid-drag) → new layer, ink with Studio Pen
 *   → colour layer below the ink (Round Brush + Gouache) → spray layer
 *   (Medium Nozzle) → smudge → eraser → two-finger-tap undo / three-finger-tap
 *   redo → pinch zoom → touch-and-hold eyedropper → hide sketch + Background
 *   colour → Share Image → PNG (Transparent): verifies the downloaded file is
 *   4500×5400 with real alpha → Use on mockup (tee + hoodie) → gallery
 *   thumbnail.
 *
 *   SKIP_BUILD=1 node scripts/design-studio/procreate-walkthrough.mjs
 */
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import * as L from './lib.mjs';

const OUT = L.shotDir('design-studio-procreate');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const env = await L.start();
let page;
try {
  ({ page } = await L.openStudio(env));
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const tap = async (testId, opts = {}) => {
    await page.locator(`[data-testid="${testId}"]`).first().click(opts);
    await page.waitForTimeout(opts.wait ?? 350);
  };
  const layerIds = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="layer-row-main-"]')].map(e => e.getAttribute('data-testid').replace('layer-row-main-', '')));
  const strokeCount = () => page.evaluate(() => (window.__btStrokeCount ?? null));
  const pickBrush = async (set, id) => {
    // Tapping the already-active paint tool opens its Brushes panel (Procreate).
    await tap('btn-brush');
    if (!(await page.locator('[data-testid="brush-library"]').count())) await tap('btn-brush');
    await tap(`brush-category-${set}`);
    await tap(`brush-select-${id}`);
    await tap('brush-library-done', { wait: 500 });
  };
  const setColor = async (hex) => {
    await tap('btn-color', { wait: 500 });
    await tap('color-tab-value', { wait: 300 }).catch(() => {});
    const input = page.locator('[data-testid="color-hex-input"]').first();
    await input.fill(hex.replace('#', ''));
    await input.press('Enter');
    await page.waitForTimeout(200);
    await tap('color-done', { wait: 500 });
  };
  const setSize = async (frac) => {
    const box = await page.locator('[data-testid="brush-size-slider"]').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    const y0 = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 9 }] });
    const target = box.y + box.height * (1 - frac);
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (target - y0) * (i / 8), id: 9 }] });
      await page.waitForTimeout(16);
    }
    return async () => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); await page.waitForTimeout(200); };
  };
  const newLayer = async () => {
    await tap('btn-layers', { wait: 500 });
    await tap('layers-add-layer', { wait: 400 });
    await tap('layers-done', { wait: 500 });
  };

  // ── Gallery ─────────────────────────────────────────────────────────────
  await shot('01-gallery');

  // ── New canvas: Apparel Print 4500×5400 ─────────────────────────────────
  await L.newCanvas(page, 'tshirt_print');
  check('apparel canvas opens with the paint surface', await page.locator('[data-testid="paint-surface"]').count() === 1);

  // ── Brushes panel ───────────────────────────────────────────────────────
  await tap('btn-brush', { wait: 600 });
  await tap('brush-category-Sketching', { wait: 600 });
  await page.waitForSelector('[data-testid="brush-preview-6b-pencil"]', { timeout: 8000 });
  await shot('02-brush-library-sketching');
  const railLabels = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="brush-category-"]')].map(e => e.getAttribute('data-testid').replace('brush-category-', '')));
  check('brush rail lists all 12 Procreate sets', ['Sketching', 'Inking', 'Drawing', 'Painting', 'Artistic', 'Calligraphy', 'Airbrushing', 'Textures', 'Abstract', 'Charcoals', 'Elements', 'Spraypaints'].every(s => railLabels.includes(s)), railLabels.join(', '));
  await tap('brush-category-Spraypaints', { wait: 600 });
  await shot('03-brush-library-spraypaints');
  // Set long-press menu + "Delete set?" confirm (cancel it).
  await page.locator('[data-testid="brush-category-Abstract"]').first().click({ delay: 700 });
  await page.waitForTimeout(400);
  const menuShown = await page.locator('[data-testid="brush-set-menu"]').count() === 1;
  check('long-press a set shows Rename / Delete / Share / Duplicate', menuShown);
  if (menuShown) {
    await shot('04-brush-set-menu');
    await tap('brush-set-delete', { wait: 400 });
    check('"Delete set?" confirm appears', await page.locator('[data-testid="brush-delete-set-confirm"]').count() === 1);
    await shot('05-brush-delete-set-confirm');
    await tap('brush-delete-set-cancel', { wait: 400 });
  }
  await tap('brush-category-Sketching', { wait: 300 });
  await tap('brush-select-6b-pencil');
  await tap('brush-library-done', { wait: 500 });

  // ── Colour picker: Disc ─────────────────────────────────────────────────
  await tap('btn-color', { wait: 600 });
  await tap('color-tab-disc', { wait: 500 });
  await shot('05b-colour-disc');
  await tap('color-done', { wait: 400 });

  // ── Sketch (6B Pencil, grey) ────────────────────────────────────────────
  await setColor('#6B6B6B');
  const release = await setSize(0.55);
  await shot('06-size-hud');
  check('Size HUD shows while dragging', await page.locator('text=/Size \\d+%/').count() > 0);
  await release();
  await L.stroke(page, L.circlePts(0.5, 0.36, 0.3, 48, 0, Math.PI * 2, 0.25), { steps: 3 });
  await L.stroke(page, [[0.56, 0.16], [0.4, 0.4], [0.52, 0.4], [0.44, 0.58], [0.64, 0.3], [0.52, 0.3], [0.6, 0.16], [0.56, 0.16]], { steps: 6 });
  await L.stroke(page, [[0.22, 0.72], [0.78, 0.72]], { steps: 10 });
  await L.stroke(page, [[0.26, 0.8], [0.74, 0.8]], { steps: 10 });
  await shot('07-sketch');

  // ── Ink on a new layer (Studio Pen, black) ──────────────────────────────
  await newLayer();
  await pickBrush('Inking', 'studio-pen');
  await setColor('#111111');
  await (await setSize(0.5))();
  await L.stroke(page, L.circlePts(0.5, 0.36, 0.3, 64, 0, Math.PI * 2, 0.25), { steps: 3 });
  await L.stroke(page, [[0.56, 0.16], [0.4, 0.4], [0.52, 0.4], [0.44, 0.58], [0.64, 0.3], [0.52, 0.3], [0.6, 0.16], [0.56, 0.16]], { steps: 8 });
  for (const y of [0.7, 0.76, 0.82]) await L.stroke(page, [[0.24, y], [0.4, y - 0.015], [0.6, y + 0.01], [0.76, y]], { steps: 10 });
  await shot('08-ink');

  // ── Colour on a new layer, moved below the ink ──────────────────────────
  await newLayer();
  await pickBrush('Painting', 'round-brush');
  await setColor('#E8312F');
  await (await setSize(0.85))();
  for (let i = 0; i < 9; i++) {
    const y = 0.15 + i * 0.026;
    await L.stroke(page, [[0.36 - i * 0.01, y], [0.66 + i * 0.008, y]], { steps: 8, delay: 4 });
  }
  await pickBrush('Painting', 'gouache');
  await setColor('#F6C21C');
  await L.stroke(page, [[0.5, 0.22], [0.47, 0.38], [0.54, 0.38], [0.5, 0.5]], { steps: 8 });
  // Drag the colour layer below the ink: open Layers and use its drag handle.
  await tap('btn-layers', { wait: 500 });
  let ids = await layerIds();
  const colourId = ids[0];
  const handle = await page.locator(`[data-testid="layer-drag-handle-${colourId}"]`).boundingBox();
  if (handle) {
    const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await L.touchDrag(page, from, { x: from.x, y: from.y + 70 });
  }
  ids = await layerIds();
  check('colour layer reordered below the ink', ids.indexOf(colourId) === 1, ids.join(' > '));
  await tap('layers-done', { wait: 500 });
  await shot('09-colour-under-ink');

  // ── Spray paint layer (Medium Nozzle) on top ────────────────────────────
  await newLayer();
  await pickBrush('Spraypaints', 'medium-nozzle');
  await setColor('#111111');
  await (await setSize(0.7))();
  await L.stroke(page, [[0.18, 0.12], [0.3, 0.08], [0.2, 0.2]], { steps: 8 });
  await L.stroke(page, [[0.82, 0.55], [0.7, 0.62], [0.84, 0.66]], { steps: 8 });
  await shot('10-spray');

  // ── Smudge the spray, erase part of it ──────────────────────────────────
  await tap('btn-smudge');
  await L.stroke(page, [[0.2, 0.14], [0.32, 0.2]], { steps: 10 });
  await tap('btn-eraser');
  await (await setSize(0.6))();
  await L.stroke(page, [[0.7, 0.6], [0.86, 0.64]], { steps: 10 });
  await shot('11-smudge-erase');

  // ── Undo / redo by gesture ──────────────────────────────────────────────
  const before = await page.evaluate(() => [...document.querySelectorAll('canvas[data-layer-id]')].map(c => c.toDataURL().length));
  await L.multiTap(page, 2);
  const afterUndo = await page.evaluate(() => [...document.querySelectorAll('canvas[data-layer-id]')].map(c => c.toDataURL().length));
  check('two-finger tap undoes the last stroke', JSON.stringify(before) !== JSON.stringify(afterUndo));
  await L.multiTap(page, 3);
  const afterRedo = await page.evaluate(() => [...document.querySelectorAll('canvas[data-layer-id]')].map(c => c.toDataURL().length));
  check('three-finger tap redoes it', JSON.stringify(afterRedo) === JSON.stringify(before));

  // ── Pinch zoom / rotate, then back ──────────────────────────────────────
  await tap('btn-brush');
  await L.pinch(page, { scale: 1.7, rotateDeg: 18 });
  const zoomed = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="canvas-artboard"]')).transform);
  check('pinch zooms + rotates the canvas', zoomed !== 'none' && zoomed !== 'matrix(1, 0, 0, 1, 0, 0)', zoomed);
  await shot('12-pinch-zoom');
  await L.pinch(page, { scale: 1 / 1.7, rotateDeg: -18 });

  // ── Touch-and-hold eyedropper on the red ────────────────────────────────
  const lift = await L.hold(page, [0.5, 0.17], { ms: 800, keep: true });
  const loupe = await page.locator('[data-testid="eyedropper-loupe"]').count();
  await shot('13-eyedropper-hold');
  await lift();
  check('touch-and-hold shows the eyedropper loupe', loupe === 1);
  const swatch = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="btn-color"] div')).backgroundColor);
  check('eyedropper picked the red', /rgb\(2[0-9]{2}, [0-9]{1,2}, [0-9]{1,2}\)/.test(swatch), swatch);

  // ── Layers: hide sketch + background ────────────────────────────────────
  await tap('btn-layers', { wait: 500 });
  ids = await layerIds();
  const sketchId = ids[ids.length - 1];
  await tap(`layer-visibility-${sketchId}`);
  await tap('layer-visibility-background');
  await tap(`layer-blend-button-${ids[1]}`, { wait: 400 });
  await shot('14-layers');
  await tap(`layer-blend-button-${ids[1]}`, { wait: 300 });
  await tap('layers-done', { wait: 600 });
  await shot('15-design-transparent');

  // ── Export: Share Image → PNG (Transparent) ─────────────────────────────
  await tap('btn-modify-toggle', { wait: 400 });
  await tap('btn-actions', { wait: 600 });
  await tap('wrench-tab-share', { wait: 400 }).catch(() => {});
  await shot('16-actions-share');
  await tap('wrench-share-image', { wait: 600 });
  await shot('17-share-image-sheet');
  const download = page.waitForEvent('download', { timeout: 120_000 });
  const t0 = Date.now();
  await tap('share-image-png-transparent', { wait: 50 });
  await page.waitForTimeout(150);
  await shot('18-exporting');
  const file = await (await download).path();
  const exportMs = Date.now() - t0;
  const b64 = readFileSync(file).toString('base64');
  // Full-size file stays out of the repo; the PR gets a checkerboard preview.
  writeFileSync(path.join(L.WORK_DIR, 'export-transparent-4500x5400.png'), readFileSync(file));
  const px = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const at = (x, y) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let transparent = 0, opaque = 0;
    for (let i = 3; i < d.length; i += 4 * 97) { if (d[i] === 0) transparent++; else if (d[i] === 255) opaque++; }
    const pw = 900, ph = Math.round(900 * c.height / c.width);
    const p = document.createElement('canvas');
    p.width = pw; p.height = ph;
    const pc = p.getContext('2d');
    for (let y = 0; y < ph; y += 18) for (let x = 0; x < pw; x += 18) { pc.fillStyle = ((x + y) / 18) % 2 ? '#d6d6d6' : '#ffffff'; pc.fillRect(x, y, 18, 18); }
    pc.drawImage(c, 0, 0, pw, ph);
    return { w: c.width, h: c.height, corner: at(5, 5), red: at(c.width * 0.5, c.height * 0.17), transparent, opaque, preview: p.toDataURL('image/png') };
  }, `data:image/png;base64,${b64}`);
  writeFileSync(path.join(OUT, '18b-exported-png-on-checkerboard.png'), Buffer.from(px.preview.split(',')[1], 'base64'));
  check('PNG export is full print resolution 4500×5400', px.w === 4500 && px.h === 5400, `${px.w}×${px.h} in ${exportMs}ms`);
  check('PNG keeps alpha: empty canvas is transparent', px.corner[3] === 0, `corner rgba ${px.corner}`);
  check('PNG keeps the artwork opaque', px.opaque > 1000 && px.transparent > 1000, `opaque ${px.opaque} / transparent ${px.transparent} samples; red rgba ${px.red}`);

  // ── Use on mockup ───────────────────────────────────────────────────────
  await tap('btn-actions', { wait: 600 });
  await tap('wrench-tab-share', { wait: 400 }).catch(() => {});
  await tap('wrench-use-on-mockup', { wait: 200 });
  await page.waitForSelector('[data-testid="garment-mockup"]', { timeout: 120_000 });
  await page.waitForSelector('[data-testid="mockup-artwork"]', { timeout: 10_000 });
  await page.waitForTimeout(800);
  await shot('19-mockup-tee');
  check('design is composited on the tee mockup', await page.locator('[data-testid="mockup-artwork"]').count() === 1);
  await tap('mockup-garment-color-black', { wait: 300 });
  await tap('mockup-garment-hoodie', { wait: 600 });
  await page.evaluate(() => document.querySelectorAll('div').forEach(d => { if (d.scrollTop) d.scrollTop = 0; }));
  await page.waitForTimeout(300);
  await shot('20-mockup-hoodie-black');
  // The existing add-to-product path: capture the mockup → pick a product.
  await page.getByText('Add to product', { exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.getByText('Choose product', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  check('Add to product hands the mockup to the product picker', page.url().includes('pickForMockup=1'), page.url());
  await shot('21-add-to-product-picker');
  await page.goBack();
  await page.waitForTimeout(800);

  // ── Back to the gallery: real thumbnail ─────────────────────────────────
  await page.goBack();
  await page.waitForTimeout(800);
  await tap('btn-back', { wait: 1500 });
  await shot('22-gallery-thumbnail');
  const thumbImgs = await page.evaluate(() => [...document.querySelectorAll('[data-testid="design-compositor-canvas"] image')].length);
  check('gallery thumbnail renders the painted layers', thumbImgs > 0, `${thumbImgs} raster layer images`);
} catch (err) {
  console.error(err);
  results.push({ name: 'walkthrough completed', ok: false, detail: String(err) });
  try { await page?.screenshot({ path: path.join(OUT, 'zz-failure.png') }); } catch { /* ignore */ }
} finally {
  await env.close();
}
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
