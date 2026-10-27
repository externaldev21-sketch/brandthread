#!/usr/bin/env node
/**
 * Hands-on check of the AI image tools at 390x844 against the REAL api-server
 * routes: Remove Background's one-screen flow (empty, sparkle while working,
 * the background dissolving, the edge glisten, done, refine, use/share/save
 * row), and the Mockup to Model / AI Photoshoot screens (dock position, real
 * engine response).
 *
 * The app runs as the harness's signed-in demo seller (not the signed-out
 * preview, which never calls paid APIs). Calls to /api/bg-removal/* and
 * /api/photography/* are forwarded to the real routers served by
 * artifacts/api-server/scripts/aiImageVerification/serveTools.ts, so every
 * cutout shown is the production model's output.
 *
 *   (cd ../api-server && PORT=8791 DATABASE_URL=postgres://unused@127.0.0.1:1/unused npx tsx scripts/aiImageVerification/serveTools.ts) &
 *   node scripts/ai-image-tools-verify.mjs
 *
 * Needs a preview build first (store-screenshots/harness.mjs buildPreviewWeb).
 * Output: docs/verification/ai-image-tools/app/
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser as harnessBrowser, serveBuild, openContext, waitForQuietNetwork, DEFAULT_BUILD_DIR, MOBILE_ROOT } from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const REPO = path.resolve(MOBILE_ROOT, '../..');
const OUT = path.join(REPO, 'docs/verification/ai-image-tools/app');
const TOOLS = process.env.AI_TOOLS_SERVER ?? 'http://127.0.0.1:8791';
const PHOTO = path.join(MOBILE_ROOT, 'assets/videos/fashion_runway_09.jpg');
const TEE = path.join(REPO, 'artifacts/api-server/scripts/aiImageVerification/fixtures/brandthread-logo-tee-mockup.jpg');
const REFS = [path.join(MOBILE_ROOT, 'assets/videos/fashion_runway_03.jpg'), path.join(MOBILE_ROOT, 'assets/videos/fashion_runway_07.jpg')];
const DEVICE = {
  viewport: { width: 390, height: 844 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};
mkdirSync(OUT, { recursive: true });

/** The harness browser, or a preinstalled Chromium (PLAYWRIGHT_CHROMIUM) when the pinned one isn't downloaded. */
async function launchBrowser() {
  try {
    return await harnessBrowser();
  } catch (error) {
    if (!process.env.PLAYWRIGHT_CHROMIUM) throw error;
    const { chromium } = await import('playwright');
    return chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
  }
}

const srv = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
const log = [];

async function newPage() {
  const { context, page, activity } = await openContext(browser, {
    device: DEVICE, role: 'seller', origin: srv.origin, images, installClock: false,
    contextOptions: { reducedMotion: 'no-preference', acceptDownloads: true },
  });
  // A real signed-in seller session, not the signed-out preview (which refuses paid calls).
  await context.addInitScript(() => localStorage.setItem('bt:previewRole:seller-review-v2', 'guest'));
  await page.route(/\/api(\/v1)?\/(bg-removal|photography)\//, async (route) => {
    const req = route.request();
    const origin = srv.origin;
    const cors = {
      'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const started = Date.now();
    const resp = await fetch(`${TOOLS}${url.pathname}`, { method: req.method(), headers: { 'content-type': 'application/json' }, body: req.postData() ?? undefined });
    const body = await resp.text();
    log.push(`${req.method()} ${url.pathname} -> ${resp.status} in ${Date.now() - started} ms${resp.ok ? '' : ` ${body.slice(0, 160)}`}`);
    return route.fulfill({ status: resp.status, headers: cors, contentType: 'application/json', body });
  });
  return { context, page, activity };
}

async function open(page, activity, target) {
  await page.goto(`${srv.origin}/?bt_preview=guest`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 30000 });
  await waitForQuietNetwork(activity, 800, 15000).catch(() => {});
  await page.waitForTimeout(1200);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.evaluate((url) => { history.pushState(history.state, '', url); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, target);
    await page.waitForTimeout(1500);
    if (await page.evaluate((p) => location.pathname === p, target.split('?')[0])) return;
  }
  throw new Error(`could not reach ${target}`);
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

// ── Remove Background ──────────────────────────────────────────────────────
{
  const { context, page, activity } = await newPage();
  await open(page, activity, '/design-bg-removal');
  await page.waitForSelector('[data-testid=bg-removal-dropzone]', { timeout: 20000 });
  await page.waitForTimeout(800);
  await shot(page, 'bg-01-empty');

  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), page.click('[data-testid=bg-removal-dropzone]')]);
  await chooser.setFiles(PHOTO);
  // No second tap: removal starts on its own and the stage sparkles while the real model runs.
  await page.waitForSelector('[data-testid=bg-removal-sparkle]', { timeout: 10000 });
  log.push('removal started without a second tap: yes');
  for (const ms of [900, 1400, 2200]) { await page.waitForTimeout(ms); await shot(page, `bg-02-working-${ms}`); }

  // The cutout lands: capture the dissolve and the glisten as they happen.
  const t0 = Date.now();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=bg-removal-sparkle] img').length > 2, undefined, { timeout: 120000 });
  log.push(`cutout arrived ${Date.now() - t0} ms after the working frames`);
  // Back-to-back frames (CSS-pixel JPEGs are quick) through the ~2.4 s dissolve and ~1.1 s glisten.
  const frames = [];
  const tFrames = Date.now();
  while (Date.now() - tFrames < 4200) {
    frames.push({ ms: Date.now() - tFrames, buf: await page.screenshot({ type: 'jpeg', quality: 90, scale: 'css' }) });
  }
  const { writeFileSync } = await import('node:fs');
  // Every 6th frame is enough to judge the motion; keeps the folder small.
  frames.forEach((f, i) => { if (process.env.ALL_FRAMES || i % 6 === 0) writeFileSync(path.join(OUT, `bg-03-frame-${String(f.ms).padStart(4, '0')}ms.jpg`), f.buf); });
  log.push(`dissolve + glisten frames: ${frames.length} over ${Date.now() - tFrames} ms`);

  await page.waitForSelector('[data-testid=bg-removal-save]', { timeout: 15000 });
  await page.waitForTimeout(700);
  await shot(page, 'bg-05-done');
  await page.click('[aria-label=White]'); await page.waitForTimeout(400); await shot(page, 'bg-06-done-white');
  await page.click('[aria-label=Black]'); await page.waitForTimeout(400); await shot(page, 'bg-07-done-black');
  await page.click('[aria-label=Transparent]');
  await page.click('[data-testid=bg-removal-refine]'); await page.waitForTimeout(600);
  await shot(page, 'bg-08-refine-overlay');
  await page.click('[data-testid=bg-removal-refine-done]'); await page.waitForTimeout(800);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('[data-testid=bg-removal-save]')]);
  log.push(`save download: ${dl ? dl.suggestedFilename() : 'none'}`);
  await page.waitForTimeout(400);
  await shot(page, 'bg-09-saved');
  const dock = await page.evaluate(() => {
    const r = (id) => document.querySelector(`[data-testid=${id}]`)?.getBoundingClientRect();
    return ['bg-removal-refine', 'bg-removal-share', 'bg-removal-use', 'bg-removal-save'].map((id) => { const b = r(id); return b ? `${id} ${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}` : `${id} missing`; });
  });
  log.push(`done actions: ${dock.join(' | ')}`);
  await context.close();
}

// ── Mockup to Model ───────────────────────────────────────────────────────
{
  const { context, page, activity } = await newPage();
  await open(page, activity, '/design-mockup-to-model');
  await page.waitForSelector('[data-testid=create-model-photos-btn]', { timeout: 20000 });
  await page.waitForTimeout(600);
  // The first-run tip is a one-time overlay; dismiss it so the form itself is visible.
  for (const label of ['Skip', 'Done']) {
    const tip = page.getByText(label, { exact: true });
    if (await tip.count()) { await tip.first().click().catch(() => {}); await page.waitForTimeout(400); }
  }
  const pick = async (label, files) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), page.click(`[aria-label="${label}"]`)]);
    await chooser.setFiles(files);
    await page.waitForTimeout(900);
  };
  await pick('Upload garment mockup', TEE);
  await pick('Add reference model images', REFS);
  await shot(page, 'm2m-01-ready');
  const geo = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid=create-model-photos-btn]')?.getBoundingClientRect();
    return btn ? { buttonBottomGap: Math.round(window.innerHeight - btn.bottom), buttonTop: Math.round(btn.top) } : null;
  });
  log.push(`mockup-to-model dock: ${JSON.stringify(geo)} (viewport 844)`);
  await page.click('[data-testid=create-model-photos-btn]');
  await page.waitForTimeout(6000);
  await shot(page, 'm2m-02-after-create');
  await context.close();
}

// ── AI Photoshoot ─────────────────────────────────────────────────────────
{
  const { context, page, activity } = await newPage();
  await open(page, activity, '/design-ai-photoshoot');
  await page.waitForSelector('[aria-label="Generate photoshoot"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  await shot(page, 'shoot-01-setup');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), page.click('[aria-label="Upload photos"]')]);
  await chooser.setFiles(TEE);
  await page.waitForTimeout(900);
  await page.mouse.wheel(0, 1200); await page.waitForTimeout(600);
  await shot(page, 'shoot-02-options');
  await page.click('[aria-label="Generate photoshoot"]');
  await page.waitForTimeout(6000);
  await shot(page, 'shoot-03-after-generate');
  await context.close();
}

await srv.close(); await browser.close();
console.log(log.join('\n'));
