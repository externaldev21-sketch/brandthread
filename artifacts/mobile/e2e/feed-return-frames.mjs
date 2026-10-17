/**
 * Frame sequence for "Threads → Messages → back to Threads": records the
 * on-screen rect of the visible slideshow image on EVERY animation frame
 * after returning, plus screenshots, on the `demo=1` web preview (sample data).
 *   node e2e/feed-return-frames.mjs <outDir> [baseUrl] [prefix]
 * Needs `expo start --web` running (default http://127.0.0.1:8081).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'screenshots/feed-return';
const base = process.argv[3] ?? 'http://127.0.0.1:8081';
const prefix = process.argv[4] ?? 'after';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
await page.route(/\/api\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
// Demo data is keyed off `?bt_preview=buyer&demo=1`; tab navigation rewrites
// the URL without it, which would swap the sample feed mid-test. Keep it.
await page.addInitScript(() => {
  const keep = (url) => {
    if (url == null) return url;
    const u = new URL(String(url), location.href);
    if (!u.searchParams.has('demo')) { u.searchParams.set('bt_preview', 'buyer'); u.searchParams.set('demo', '1'); }
    return u.pathname + u.search + u.hash;
  };
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn].bind(history);
    history[fn] = (state, title, url) => orig(state, title, keep(url));
  }
});

async function tidy() {
  await page.addStyleTag({ content: '#error-overlay,#error-toast{display:none!important}' }).catch(() => {});
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 1500 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 1000 }).catch(() => {});
  await page.getByText(/got it/i).first().click({ timeout: 1000 }).catch(() => {});
  const guide = page.getByTestId('feed-gesture-guide');
  if (await guide.isVisible().catch(() => false)) await guide.click({ position: { x: 10, y: 10 } });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('div')) {
      if (el.childElementCount < 6 && /^Clerk: Failed/.test(el.textContent ?? '')) {
        let node = el;
        while (node && getComputedStyle(node).position !== 'fixed' && node.parentElement) node = node.parentElement;
        if (node) node.style.display = 'none';
      }
    }
  });
}

/** Starts a rAF logger: every frame, the rect of every visible slideshow/overlay image. */
async function startFrameLog() {
  await page.evaluate(() => {
    const log = [];
    const t0 = performance.now();
    window.__frames = log;
    const vis = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    const tick = () => {
      const imgs = [...document.querySelectorAll('[data-testid^="photo-carousel-"] img, img')]
        .map((img) => ({ img, r: img.getBoundingClientRect() }))
        .filter(({ img, r }) => vis(r) && img.naturalWidth > 0 && getComputedStyle(img).opacity !== '0' && r.width > 200)
        .map(({ img, r }) => ({
          src: img.currentSrc.split('/').pop()?.slice(0, 40),
          inCarousel: !!img.closest('[data-testid^="photo-carousel-"]'),
          x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
        }));
      log.push({ t: Math.round(performance.now() - t0), imgs });
      if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

await page.goto(`${base}/?bt_preview=buyer&demo=1`, { waitUntil: 'domcontentloaded', timeout: 600_000 });
await page.getByTestId('buyer-bottom-tab-bar').waitFor({ timeout: 600_000 });
await page.waitForTimeout(6000);
await tidy();
// Start inside the Home tab itself (the screen "tap Home" returns to).
await page.getByTestId('buyer-tab-index').click();
await page.waitForTimeout(3000);
await tidy();
// The official slideshow sits in slot 4: swipe up three Threads.
for (let i = 0; i < 3; i += 1) {
  await page.mouse.move(196, 420);
  await page.mouse.wheel(0, 852);
  await page.waitForTimeout(1300);
}
await page.waitForTimeout(2500);
await tidy();
await page.screenshot({ path: `${out}/${prefix}-1-threads-slideshow.png` });

// Messages tab.
await page.getByTestId('buyer-tab-inbox').click();
await page.waitForTimeout(2500);
await tidy();
await page.screenshot({ path: `${out}/${prefix}-2-messages.png` });

// Back to Threads (Home tab) — log every frame from the tap on.
await startFrameLog();
await page.getByTestId('buyer-tab-index').click();
const shots = [];
for (let i = 0; i < 8; i += 1) {
  const name = `${prefix}-3-back-frame-${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: `${out}/${name}` });
  shots.push(name);
  await page.waitForTimeout(60);
}
await page.waitForTimeout(2600);
const frames = await page.evaluate(() => window.__frames);
writeFileSync(`${out}/${prefix}-frames.json`, JSON.stringify(frames, null, 1));
await page.screenshot({ path: `${out}/${prefix}-4-threads-settled.png` });

// Summary: distinct sizes of the carousel image across all logged frames after the tap.
const carousel = frames.flatMap((f) => f.imgs.filter((i) => i.inCarousel).map((i) => `${i.w}x${i.h}@${i.x},${i.y}`));
const anyImg = frames.flatMap((f) => f.imgs.map((i) => `${i.inCarousel ? 'carousel' : 'other'} ${i.w}x${i.h}@${i.x},${i.y}`));
console.log(JSON.stringify({
  framesLogged: frames.length,
  carouselRects: [...new Set(carousel)],
  allVisibleImageRects: [...new Set(anyImg)],
}, null, 1));

await browser.close();
