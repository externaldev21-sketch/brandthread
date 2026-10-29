/**
 * procreate-parity-2.mjs — Design Studio vs Procreate Pocket, pass 2.
 *
 * Walks every Studio flow hands-on at 390×844 with real touch input (CDP
 * touch events for strokes, sliders and multi-finger gestures), captures a
 * screenshot per flow into docs/pr-assets/design-studio-procreate-2/ and
 * FAILS if any mechanism doesn't do what Procreate's does:
 *
 *   sidebar Size/Opacity sliders (extreme range + live card) · every brush in
 *   every set · eraser / smudge · undo / redo (buttons + 2/3-finger taps) ·
 *   layers (add, select, opacity, merge, instant delete + undo) · colours
 *   (disc tap, panel + modify-square eyedropper, touch-and-hold loupe) ·
 *   selection modes · transform Freeform/Uniform/Distort/Warp with the live
 *   Width/Height px readout · pinch zoom+rotate with glide, quick-pinch fit,
 *   three-finger Copy & Paste, four-finger full screen, brush cursor ·
 *   Actions: Add / Canvas / Guides / Share (Share image ×3, More export
 *   options, Save a copy, Save version, Version history restore, Use as
 *   product photo, Use in a post, Use on mockup).
 *
 *   SKIP_BUILD=1 node scripts/design-studio/procreate-parity-2.mjs
 */
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import * as L from './lib.mjs';

const OUT = L.shotDir('design-studio-procreate-2');
const PHOTO = path.resolve(OUT, '../design-studio-procreate/19-mockup-tee.png');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const env = await L.start();
let page;
try {
  ({ page } = await L.openStudio(env));
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const has = async (id) => (await page.locator(`[data-testid="${id}"]`).count()) > 0;
  const tap = async (id, opts = {}) => {
    await page.locator(`[data-testid="${id}"]`).first().click(opts);
    await page.waitForTimeout(opts.wait ?? 350);
  };
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const pixels = () => page.evaluate(() => [...document.querySelectorAll('canvas[data-layer-id]')].map(c => c.toDataURL().length).join());
  const layerIds = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="layer-row-main-"]')].map(e => e.getAttribute('data-testid').replace('layer-row-main-', '')));
  const swatch = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="btn-color"] div')).backgroundColor);
  const alertText = async () => ((await has('web-alert-backdrop')) ? (await page.locator('[data-testid="web-alert-backdrop"]').innerText()).replace(/\n/g, ' | ') : null);
  const dismissAlert = async () => {
    const t = await alertText();
    if (t) { await page.locator('[data-testid="web-alert-backdrop"]').getByRole('button').last().click(); await page.waitForTimeout(300); }
    return t;
  };
  const actions = async (tab) => {
    if (!(await has('btn-actions'))) await tap('btn-modify-toggle', { wait: 300 });
    await tap('btn-actions', { wait: 400 });
    await tap(`wrench-tab-${tab}`, { wait: 300 });
  };
  const setColor = async (hex) => {
    await tap('btn-color', { wait: 400 });
    await tap('color-tab-value', { wait: 250 });
    const input = page.locator('[data-testid="color-hex-input"]').first();
    await input.fill(hex.replace('#', ''));
    await input.press('Enter');
    await page.waitForTimeout(150);
    await tap('color-done', { wait: 350 });
  };
  const pickBrush = async (set, id) => {
    await tap('btn-brush');
    if (!(await has('brush-library'))) await tap('btn-brush');
    await tap(`brush-category-${set}`, { wait: 250 });
    await tap(`brush-select-${id}`, { wait: 150 });
    await tap('brush-library-done', { wait: 300 });
  };
  /**
   * Drags a sidebar slider by `delta` track-lengths (+ up, − down; ±2 pins
   * it to an end — the handle is relative, like Procreate's) and returns a
   * lift(): the preview card stays up until then.
   */
  const dragSlider = async (testId, delta) => {
    const box = await page.locator(`[data-testid="${testId}"]`).boundingBox();
    const x = box.x + box.width / 2, y0 = box.y + box.height / 2;
    const dy = -delta * (box.height - 12);
    await touch('touchStart', [{ x, y: y0, id: 9 }]);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x, y: y0 + dy * (i / 10), id: 9 }]); await page.waitForTimeout(16); }
    await page.waitForTimeout(120);
    return async () => { await touch('touchEnd', []); await page.waitForTimeout(200); };
  };

  // ── Gallery ─────────────────────────────────────────────────────────────
  await shot('01-gallery');

  // ── Sidebar sliders: extreme Size range + live card (Dev's #1) ──────────
  await L.newCanvas(page, 'ig_post');
  let lift = await dragSlider('brush-size-slider', -2);
  const lo = { label: await page.locator('[data-testid="slider-preview-label"]').innerText(), dot: await page.locator('[data-testid="slider-preview-dot"], [data-testid="size-hud-dab"]').first().boundingBox() };
  await shot('02-size-1pct-card');
  await lift();
  await L.stroke(page, [[0.08, 0.2], [0.92, 0.2]], { steps: 24, delay: 24 });
  lift = await dragSlider('brush-size-slider', 2);
  const hi = { label: await page.locator('[data-testid="slider-preview-label"]').innerText(), dot: await page.locator('[data-testid="slider-preview-dot"], [data-testid="size-hud-dab"]').first().boundingBox() };
  await shot('03-size-100pct-card');
  await lift();
  await L.stroke(page, [[0.08, 0.55], [0.92, 0.55]], { steps: 24, delay: 24 });
  check('Size slider bottoms out at "Size 1%" with a pin-prick dot', lo.label === 'Size 1%' && lo.dot && lo.dot.width <= 6, `${lo.label}, dot ${lo.dot?.width?.toFixed(1)}px`);
  check('Size slider tops out at "Size 100%" with a massive dot', hi.label === 'Size 100%' && hi.dot && hi.dot.width >= 40, `${hi.label}, dot ${hi.dot?.width?.toFixed(1)}px`);
  // Painted thickness of each stroke, measured down the artboard's centre column in its own band.
  const bands = await (async () => {
    const b = await L.artboardBox(page);
    const col = async (y0, y1) => {
      const png = await page.screenshot({ clip: { x: Math.round(b.x + b.width * 0.5), y: Math.round(b.y + b.height * y0), width: 1, height: Math.round(b.height * (y1 - y0)) } });
      return page.evaluate(async (b64) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 0; i < c.height; i++) if (d[i * c.width * 4] < 128) n++;
        return n / 2;
      }, png.toString('base64'));
    };
    return { thin: await col(0.05, 0.35), fat: await col(0.35, 0.9) };
  })();
  check('a Size 100% stroke is dramatically thicker than a Size 1% stroke', bands.fat >= bands.thin * 8 && bands.fat >= 30, `${bands.thin}px → ${bands.fat}px on screen`);
  await shot('04-size-1-vs-100-strokes');
  lift = await dragSlider('brush-opacity-slider', -0.75);
  const op = { label: await page.locator('[data-testid="slider-preview-label"]').innerText(), alpha: await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="slider-preview-dot"]')).opacity) };
  await shot('05-opacity-card');
  await lift();
  check('Opacity slider shows "Opacity N%" with the dot faded to match', /^Opacity \d+%$/.test(op.label) && Number(op.alpha) < 0.5, `${op.label}, dot opacity ${op.alpha}`);
  lift = await dragSlider('brush-opacity-slider', 2); await lift();
  lift = await dragSlider('brush-size-slider', -0.45); await lift();

  // ── Every brush in every set paints ─────────────────────────────────────
  await L.newCanvas(page, 'ig_post').catch(async () => { await tap('btn-back', { wait: 1200 }); await L.newCanvas(page, 'ig_post'); });
  await tap('btn-brush'); if (!(await has('brush-library'))) await tap('btn-brush');
  const sets = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="brush-category-"]')].map(e => e.getAttribute('data-testid').replace('brush-category-', '')));
  await tap('brush-library-done');
  const painted = []; let row = 0;
  for (const set of sets) {
    await tap('btn-brush'); if (!(await has('brush-library'))) await tap('btn-brush');
    await tap(`brush-category-${set}`, { wait: 250 });
    const ids = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="brush-select-"]')].map(e => e.getAttribute('data-testid').replace('brush-select-', '')));
    await tap('brush-library-done', { wait: 250 });
    for (const id of ids) {
      await pickBrush(set, id);
      const y = 0.04 + (row % 12) * 0.08, x0 = 0.05 + Math.floor(row / 12) * 0.25;
      const before = await pixels();
      await L.stroke(page, [[x0, y], [x0 + 0.1, y + 0.03], [x0 + 0.2, y]], { steps: 10, delay: 16 });
      painted.push({ id, ok: before !== await pixels() });
      row++;
    }
  }
  await shot('06-every-brush');
  check(`all ${painted.length} brushes across ${sets.length} sets paint`, painted.length >= 45 && painted.every(p => p.ok), painted.filter(p => !p.ok).map(p => p.id).join(', '));

  // ── Smudge + eraser ─────────────────────────────────────────────────────
  let px0 = await pixels();
  await tap('btn-smudge');
  await L.stroke(page, [[0.05, 0.1], [0.3, 0.3]], { steps: 12, delay: 16 });
  const smudged = px0 !== await pixels();
  px0 = await pixels();
  await tap('btn-eraser');
  await L.stroke(page, [[0.4, 0.02], [0.4, 0.98]], { steps: 24, delay: 16 });
  check('smudge drags paint and the eraser removes it', smudged && px0 !== await pixels());
  await shot('07-smudge-erase');

  // ── Undo / redo: sidebar buttons + two/three-finger taps ────────────────
  px0 = await pixels();
  await tap('btn-undo'); const u1 = await pixels();
  await tap('btn-redo'); const r1 = await pixels();
  await L.multiTap(page, 2); const u2 = await pixels();
  await L.multiTap(page, 3); const r2 = await pixels();
  check('undo/redo buttons and 2-/3-finger taps step history', u1 !== px0 && r1 === px0 && u2 !== px0 && r2 === px0);
  await tap('btn-brush');

  // ── Layers ──────────────────────────────────────────────────────────────
  await L.newCanvas(page, 'ig_post').catch(async () => { await tap('btn-back', { wait: 1200 }); await L.newCanvas(page, 'ig_post'); });
  await pickBrush('Inking', 'studio-pen');
  lift = await dragSlider('brush-size-slider', 0.15); await lift();
  await setColor('#E8312F');
  await L.stroke(page, [[0.1, 0.3], [0.9, 0.3]], { steps: 30, delay: 16 });
  await tap('btn-layers', { wait: 400 });
  await tap('layers-add-layer', { wait: 300 });
  await tap('layers-done', { wait: 300 });
  await setColor('#1E5BFF');
  await L.stroke(page, [[0.1, 0.6], [0.9, 0.6]], { steps: 30, delay: 16 });
  await tap('btn-layers', { wait: 400 });
  let ids = await layerIds();
  await tap(`layer-blend-button-${ids[0]}`, { wait: 300 });
  const ob = await page.locator(`[data-testid="layer-opacity-${ids[0]}"]`).boundingBox();
  await L.touchDrag(page, { x: ob.x + ob.width - 4, y: ob.y + ob.height / 2 }, { x: ob.x + ob.width * 0.3, y: ob.y + ob.height / 2 });
  const layerAlpha = await page.evaluate((id) => { let e = document.querySelector(`canvas[data-layer-id="${id}"]`); while (e) { const o = getComputedStyle(e).opacity; if (o !== '1') return Number(o); e = e.parentElement; } return 1; }, ids[0]);
  await shot('08-layer-opacity');
  await tap(`layer-blend-button-${ids[0]}`, { wait: 250 });
  check('layer opacity slider fades the layer', layerAlpha < 0.6, `opacity ${layerAlpha}`);
  await page.locator(`[data-testid="layer-row-main-${ids[0]}"]`).first().click({ delay: 600 });
  await page.waitForTimeout(300);
  await shot('09-layer-menu');
  await tap(`layer-menu-merge-${ids[0]}`, { wait: 400 });
  check('Merge Down combines the two layers', (await layerIds()).length === 1);
  await tap('layers-add-layer', { wait: 300 });
  ids = await layerIds();
  await page.locator(`[data-testid="layer-row-main-${ids[0]}"]`).first().click({ delay: 600 });
  await page.waitForTimeout(300);
  await tap(`layer-menu-delete-${ids[0]}`, { wait: 300 });
  const afterDelete = await layerIds();
  check('Delete is instant (no confirm) and the panel stays open', afterDelete.length === 1 && !(await alertText()) && await has('layers-panel'));
  await tap('layers-done', { wait: 300 });
  await tap('btn-undo', { wait: 300 });
  await tap('btn-layers', { wait: 400 });
  check('Undo brings a deleted layer back', (await layerIds()).length === 2);
  await shot('10-layers');
  await tap('layers-done', { wait: 300 });

  // ── Colours + eyedroppers ───────────────────────────────────────────────
  await tap('btn-color', { wait: 400 });
  await tap('color-tab-disc', { wait: 300 });
  const disc = await page.locator('[data-testid="color-disc"]').boundingBox();
  if (disc) {
    await touch('touchStart', [{ x: disc.x + disc.width * 0.85, y: disc.y + disc.height * 0.5, id: 4 }]);
    await touch('touchEnd', []);
    await page.waitForTimeout(300);
  }
  const discColour = await swatch();
  await shot('11-colour-disc-tap');
  check('a single tap on the colour disc picks a colour', discColour !== 'rgb(30, 91, 255)', discColour);
  await tap('color-done', { wait: 300 });
  const bx = await L.artboardBox(page);
  const paintBefore = await pixels();
  await tap('btn-modify-square', { wait: 250 });
  await touch('touchStart', [{ x: bx.x + bx.width * 0.4, y: bx.y + bx.height * 0.3, id: 1 }]);
  for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: bx.x + bx.width * (0.4 + i * 0.02), y: bx.y + bx.height * 0.3, id: 1 }]); await page.waitForTimeout(20); }
  const loupe = await has('eyedropper-loupe');
  await shot('12-eyedropper-loupe');
  await touch('touchEnd', []);
  await page.waitForTimeout(350);
  check('modify-square eyedropper: loupe while dragging, red on lift, no paint', loupe && /rgb\(23\d, 4\d, 4\d\)/.test(await swatch()) && paintBefore === await pixels(), await swatch());
  await tap('btn-color', { wait: 400 });
  await tap('color-eyedropper', { wait: 350 });
  await touch('touchStart', [{ x: bx.x + bx.width * 0.5, y: bx.y + bx.height * 0.6, id: 1 }]);
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  // The blue layer sits at ~36% opacity over white: the eyedropper samples
  // the composited colour (a light blue), exactly like Procreate.
  const panelPick = (await swatch()).match(/\d+/g).map(Number);
  check('Colours panel eyedropper samples the composited blue and returns to the panel', panelPick[2] > 240 && panelPick[0] < 200 && await has('color-picker'), await swatch());
  await tap('color-done', { wait: 300 });
  const holdLift = await L.hold(page, [0.5, 0.3], { ms: 800, keep: true });
  const holdLoupe = await has('eyedropper-loupe');
  await holdLift();
  check('touch-and-hold eyedropper shows the loupe and picks red', holdLoupe && /rgb\(23\d, 4\d, 4\d\)/.test(await swatch()), await swatch());

  // ── Selection ───────────────────────────────────────────────────────────
  await tap('btn-modify-toggle', { wait: 300 });
  await tap('btn-select', { wait: 400 });
  const selOk = [];
  for (const m of ['automatic', 'freehand', 'rectangle', 'ellipse']) {
    await tap(`sel-mode-${m}`, { wait: 250 });
    await L.touchDrag(page, { x: bx.x + bx.width * 0.2, y: bx.y + bx.height * 0.2 }, { x: bx.x + bx.width * 0.7, y: bx.y + bx.height * 0.7 });
    selOk.push(await has('selection-clear'));
    if (m === 'ellipse') await shot('13-selection-ellipse');
  }
  check('Automatic / Freehand / Rectangle / Ellipse selections all select', selOk.every(Boolean));
  if (await has('selection-clear')) await tap('selection-clear');

  // ── Insert a photo → Transform with live px readout ─────────────────────
  await actions('add');
  await shot('14-actions-add');
  const chooser = page.waitForEvent('filechooser', { timeout: 8000 });
  await tap('action-insert-a-photo', { wait: 100 });
  await (await chooser).setFiles(PHOTO);
  await page.waitForTimeout(1500);
  check('an inserted photo lands whole on the canvas, in Transform', await has('transform-mode-bar') && await has('transform-handle-br'));
  const readouts = {};
  for (const mode of ['freeform', 'uniform', 'distort', 'warp']) {
    await tap(`transform-mode-${mode}`, { wait: 250 });
    const h = await page.locator('[data-testid="transform-handle-br"]').boundingBox();
    const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    await touch('touchStart', [{ ...from, id: 5 }]);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: from.x - i * 5, y: from.y - i * 3, id: 5 }]); await page.waitForTimeout(20); }
    readouts[mode] = (await page.locator('[data-testid="transform-readout"]').innerText().catch(() => '')).replace(/\n/g, ' ');
    await shot(`15-transform-${mode}`);
    await touch('touchEnd', []);
    await page.waitForTimeout(250);
    if (mode === 'freeform') {
      const moved = await page.locator('[data-testid="transform-handle-br"]').boundingBox();
      await tap('btn-undo', { wait: 300 });
      const undone = await page.locator('[data-testid="transform-handle-br"]').boundingBox();
      check('a transform drag is one undo step', Math.abs(moved.x - undone.x) + Math.abs(moved.y - undone.y) > 10 && Math.abs(undone.x - h.x) + Math.abs(undone.y - h.y) < 2);
      await tap('btn-redo', { wait: 300 });
    }
  }
  check('Freeform / Uniform / Distort / Warp all show the live Width/Height px readout', Object.values(readouts).every(r => /Width \d+px Height \d+px/.test(r)), JSON.stringify(readouts));

  // ── Add: text, copy/paste/cut, insert a file ────────────────────────────
  await actions('add');
  await tap('action-add-text', { wait: 400 });
  await page.locator('[data-testid="add-text-input"]').fill('DROP 01');
  await page.getByText('Add to Canvas', { exact: true }).first().click();
  await page.waitForTimeout(600);
  await shot('16-add-text');
  await tap('btn-layers', { wait: 400 }); const nText = (await layerIds()).length; await tap('layers-done', { wait: 300 });
  await actions('add'); await tap('action-copy', { wait: 300 });
  const toast = await page.locator('[data-testid="studio-toast"]').first().textContent().catch(() => '');
  await actions('add'); await tap('action-paste', { wait: 400 });
  await tap('btn-layers', { wait: 400 }); const nPaste = (await layerIds()).length; await tap('layers-done', { wait: 300 });
  await actions('add'); await tap('action-cut', { wait: 400 });
  await tap('btn-layers', { wait: 400 }); const nCut = (await layerIds()).length; await tap('layers-done', { wait: 300 });
  check('Copy (toast, Actions closes) → Paste adds a layer → Cut removes one', /Copied/.test(toast) && nPaste === nText + 1 && nCut === nPaste - 1, `${toast.trim()} · ${nText} → ${nPaste} → ${nCut}`);
  await actions('add');
  const fileChooser = page.waitForEvent('filechooser', { timeout: 8000 });
  await tap('action-insert-a-file', { wait: 100 });
  await (await fileChooser).setFiles(PHOTO);
  await page.waitForTimeout(1500);
  await tap('btn-layers', { wait: 400 }); const nFile = (await layerIds()).length; await tap('layers-done', { wait: 300 });
  check('Insert a file adds an image layer', nFile === nCut + 1);

  // ── Canvas + Guides ─────────────────────────────────────────────────────
  await actions('canvas');
  await shot('17-actions-canvas');
  const artBox = await L.artboardBox(page);
  const art = (await page.screenshot({ clip: artBox })).toString('base64');
  await tap('action-flip-horizontal', { wait: 400 });
  await page.mouse.click(200, 120); await page.waitForTimeout(300);
  const flipped = (await page.screenshot({ clip: artBox })).toString('base64');
  await shot('17b-flipped');
  check('Flip horizontal mirrors the canvas', art !== flipped);
  await actions('canvas');
  if (await has('action-flip-horizontal')) await tap('action-flip-horizontal', { wait: 300 });
  else { await actions('canvas'); await tap('action-flip-horizontal', { wait: 300 }); }
  if (!(await has('action-canvas-info'))) await actions('canvas');
  await tap('action-canvas-info', { wait: 400 });
  await shot('18-canvas-info');
  check('Canvas info shows the canvas size', await page.getByText('1080 × 1080 px').count() > 0);
  await page.getByText('Close', { exact: true }).first().click();
  await page.waitForTimeout(300);
  await actions('guides');
  await page.getByText('Off', { exact: true }).nth(1).click();
  await page.waitForTimeout(300);
  await shot('19-actions-guides');
  await page.mouse.click(380, 200); await page.waitForTimeout(300);

  // ── Feel: pinch zoom+rotate with glide, quick-pinch fit, 3/4 fingers, cursor
  await tap('btn-brush');
  const tf = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="canvas-artboard"]')).transform);
  const ab = await L.artboardBox(page);
  const cx = ab.x + ab.width / 2, cy = ab.y + ab.height / 2;
  const pinchAt = (k) => [{ x: cx - 50 - k * 30 + k * 60, y: cy, id: 1 }, { x: cx + 50 + k * 30 + k * 60, y: cy + k * 18, id: 2 }];
  await touch('touchStart', pinchAt(0));
  for (let i = 1; i <= 12; i++) { await touch('touchMove', pinchAt(i / 12)); await page.waitForTimeout(16); }
  const atRelease = await tf();
  await touch('touchEnd', []);
  await page.waitForTimeout(450);
  const atRest = await tf();
  await shot('20-pinch-zoom-rotate');
  check('two-finger pinch zooms + rotates together and glides on after release', atRelease !== 'none' && atRest !== atRelease, `${atRelease} → ${atRest}`);
  const qp = (k) => [{ x: cx - 120 + k * 90, y: cy, id: 1 }, { x: cx + 120 - k * 90, y: cy, id: 2 }];
  await touch('touchStart', qp(0));
  for (let i = 1; i <= 6; i++) { await touch('touchMove', qp(i / 6)); await page.waitForTimeout(16); }
  await touch('touchEnd', []);
  await page.waitForTimeout(450);
  const fitted = await tf();
  check('a quick pinch-in snaps the canvas back to fit', fitted === 'none' || fitted === 'matrix(1, 0, 0, 1, 0, 0)', fitted);
  const three = (k) => [0, 1, 2].map(i => ({ x: cx - 60 + i * 60, y: cy - 80 + k * 120, id: i + 1 }));
  await touch('touchStart', three(0));
  for (let i = 1; i <= 8; i++) { await touch('touchMove', three(i / 8)); await page.waitForTimeout(16); }
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  const cpMenu = await has('copy-paste-menu');
  const copyEnabled = await page.evaluate(() => document.querySelector('[data-testid="copy-paste-copy"]')?.getAttribute('aria-disabled') !== 'true');
  await shot('21-three-finger-copy-paste');
  check('three-finger swipe down opens Copy & Paste, acting on the current layer', cpMenu && copyEnabled);
  await page.mouse.click(200, 120); await page.waitForTimeout(300);
  await touch('touchStart', [0, 1, 2, 3].map(i => ({ x: cx - 90 + i * 60, y: cy, id: i + 1 })));
  await page.waitForTimeout(60);
  await touch('touchEnd', []);
  await page.waitForTimeout(400);
  const fsOn = await has('btn-exit-fullscreen');
  const railHidden = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="left-slider-rail"]')).opacity === '0');
  await shot('22-four-finger-full-screen');
  check('four-finger tap hides the interface (full screen)', fsOn && railHidden);
  if (fsOn) await tap('btn-exit-fullscreen');
  await touch('touchStart', [{ x: ab.x + ab.width * 0.2, y: ab.y + ab.height * 0.85, id: 1 }]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: ab.x + ab.width * (0.2 + i * 0.05), y: ab.y + ab.height * 0.85, id: 1 }]); await page.waitForTimeout(16); }
  const cursor = await page.evaluate(() => { const e = document.querySelector('[data-testid="brush-cursor"]'); return e ? Number(getComputedStyle(e).opacity) : 0; });
  await shot('23-brush-cursor');
  await touch('touchEnd', []);
  await page.waitForTimeout(150);
  const cursorAfter = await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-testid="brush-cursor"]')).opacity));
  check('brush cursor outlines the brush under the finger while painting', cursor === 1 && cursorAfter === 0);

  // ── Share: Share image (PNG transparent / PNG / JPEG) at full res ───────
  await tap('btn-back', { wait: 1500 });
  await L.newCanvas(page, 'tshirt_print');
  await L.stroke(page, L.circlePts(0.5, 0.4, 0.25, 40), { steps: 3, delay: 8 });
  await L.stroke(page, [[0.2, 0.7], [0.8, 0.72]], { steps: 20, delay: 16 });
  const decode = (file, mime) => page.evaluate(async ([b64, mime]) => {
    const img = new Image(); img.src = `data:${mime};base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return { w: img.naturalWidth, h: img.naturalHeight, cornerAlpha: x.getImageData(2, 2, 1, 1).data[3] };
  }, [readFileSync(file).toString('base64'), mime]);
  const shares = {};
  for (const kind of ['png-transparent', 'png', 'jpeg']) {
    await actions('share');
    if (kind === 'png-transparent') await shot('24-actions-share');
    await tap('wrench-share-image', { wait: 400 });
    if (kind === 'png-transparent') await shot('25-share-image-sheet');
    const dl = page.waitForEvent('download', { timeout: 120_000 });
    await tap(`share-image-${kind}`, { wait: 50 });
    const d = await dl;
    shares[kind] = { name: d.suggestedFilename(), ...(await decode(await d.path(), kind === 'jpeg' ? 'image/jpeg' : 'image/png')) };
  }
  check('Share image saves PNG (transparent) / PNG / JPEG at 4500×5400', Object.values(shares).every(s => s.w === 4500 && s.h === 5400) && shares['png-transparent'].cornerAlpha === 0 && shares.png.cornerAlpha === 255, JSON.stringify(shares));

  // ── More export options: sizes + formats, Original = full canvas ───────
  await actions('share');
  await tap('wrench-share-more-export-options', { wait: 1500 });
  await shot('26-more-export-options');
  const exportsOk = [];
  for (const [fmt, size, w, h] of [['PNG', 'Original', 4500, 5400], ['JPG', 'Web', 1000, 1200], ['Transparent PNG', 'Product Page', 1667, 2000]]) {
    await page.getByText(fmt, { exact: true }).first().click(); await page.waitForTimeout(150);
    await page.getByText(size, { exact: true }).first().click(); await page.waitForTimeout(250);
    const dl = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByText(/^Export/).last().click();
    const d = await dl;
    const got = await decode(await d.path(), fmt === 'JPG' ? 'image/jpeg' : 'image/png');
    exportsOk.push(`${fmt}/${size} ${got.w}×${got.h}`);
    exportsOk.ok = (exportsOk.ok ?? true) && got.w === w && got.h === h;
    await page.waitForTimeout(300);
    await dismissAlert();
  }
  check('More export options downloads every format at its size (Original = 4500×5400)', exportsOk.ok, exportsOk.join(', '));
  await page.goBack(); await page.waitForTimeout(1000);

  // ── Save a copy · Save version · Version history restore ───────────────
  await actions('share');
  await tap('wrench-share-save-a-copy', { wait: 900 });
  const copyToast = await page.locator('[data-testid="studio-toast"]').first().textContent().catch(() => '');
  check('Save a copy saves to the gallery (toast, Actions closes)', /saved to your gallery/.test(copyToast) && !(await has('wrench-tabs-row')), copyToast.trim());
  await actions('share');
  await tap('wrench-share-save-version', { wait: 900 });
  const verToast = await page.locator('[data-testid="studio-toast"]').first().textContent().catch(() => '');
  check('Save version snapshots the project (toast with History)', /Version saved/.test(verToast), verToast.replace(/\n/g, ' ').trim());
  await page.waitForTimeout(2500);
  await L.stroke(page, [[0.1, 0.1], [0.9, 0.9]], { steps: 20, delay: 8 });
  const preRestore = await pixels();
  await actions('share');
  await tap('wrench-share-version-history', { wait: 1500 });
  await shot('27-version-history');
  const restoreBtn = await page.evaluate(() => document.querySelector('[data-testid^="design-version-restore-"]')?.getAttribute('data-testid'));
  await tap(restoreBtn, { wait: 400 });
  await shot('28-restore-confirm');
  await page.locator('[data-testid="web-alert-backdrop"]').getByText('Restore', { exact: true }).click();
  await page.waitForTimeout(2500);
  const restored = await pixels();
  await shot('29-restored-canvas');
  check('Version history → Restore reverts the same canvas in place', page.url().includes('/design-canvas') && restored !== preRestore);

  // ── Use in a post / Use as product photo / Use on mockup ────────────────
  await actions('share');
  await tap('wrench-share-use-in-a-post', { wait: 100 });
  await page.waitForURL(/create-post\?fromDesign=/, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await shot('30-use-in-a-post');
  check('Use in a post opens the composer with the design attached', await page.evaluate(() => [...document.querySelectorAll('img')].some(i => i.src.startsWith('data:image/png'))));
  await page.goBack(); await page.waitForTimeout(1200);
  await actions('share');
  await tap('wrench-share-use-as-product-photo', { wait: 100 });
  await page.waitForURL(/pickForMockup=1/, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot('31-use-as-product-photo');
  check('Use as product photo opens the product picker with the design waiting', await has('products-pick-hint'));
  await page.goBack(); await page.waitForTimeout(1200);
  await actions('share');
  await tap('wrench-use-on-mockup', { wait: 100 });
  await page.waitForSelector('[data-testid="mockup-artwork"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
  await shot('32-use-on-mockup');
  check('Use on mockup puts the design on the garment', await has('mockup-artwork'));
  await cdp.detach();
} catch (err) {
  console.error(err);
  results.push({ name: 'walkthrough completed', ok: false, detail: String(err).slice(0, 400) });
  try { await page?.screenshot({ path: path.join(OUT, 'zz-failure.png') }); } catch { /* ignore */ }
} finally {
  await env.close();
}
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
