/**
 * Screenshots for the @brandthread official account PR, at 393x852 on the
 * `demo=1` web preview (sample data only):
 *   node e2e/official-account-shots.mjs <outDir> [baseUrl] [prefix]
 * Needs `expo start --web` running (default http://127.0.0.1:8081).
 */
import { chromium } from '@playwright/test';
import { deflateSync } from 'node:zlib';

const out = process.argv[2] ?? 'screenshots/official-account';
const base = process.argv[3] ?? 'http://127.0.0.1:8081';
const prefix = process.argv[4] ?? 'after';

function png(w, h, rgb) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
await page.route(/\/api\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

async function open(path, waitFor) {
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '#error-overlay,#error-toast{display:none!important}' }).catch(() => {});
  if (waitFor) await page.getByTestId(waitFor).first().waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 2500 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 1500 }).catch(() => {});
  await page.getByText(/got it/i).first().click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(2500);
  await tidy();
}

/** Dismiss the first-run gesture guide and hide the dev-only Clerk error toast (no Clerk offline). */
async function tidy() {
  const guide = page.getByTestId('feed-gesture-guide');
  if (await guide.isVisible().catch(() => false)) {
    await guide.click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);
  }
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
const shot = async (name) => { await tidy(); return page.screenshot({ path: `${out}/${prefix}-${name}.png` }); };

const step = process.argv[5] ?? 'all';

if (step === 'all' || step === 'feed') {
  // 1. New user's Threads feed: slot 1 = official post with credit line.
  await open('/?bt_preview=buyer&demo=1', null);
  await page.waitForTimeout(4000);
  await shot('01-new-user-feed-slot1');
}

if (step === 'all' || step === 'carousel') {
  // 2. Official 6-photo slideshow (slot 4): slide 1, then swipe to slide 3.
  await open('/?bt_preview=buyer&demo=1', null);
  await page.waitForTimeout(3000);
  // Swipe up three Threads (official slideshow sits in slot 4).
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.move(196, 420);
    await page.mouse.wheel(0, 852);
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(2500);
  await shot('02-carousel-slide1');
  // Swipe left twice → slide 3.
  for (let i = 0; i < 2; i += 1) {
    await page.mouse.move(196, 600);
    await page.mouse.wheel(393, 0);
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(2000);
  await shot('03-carousel-slide3');
}

if (step === 'all' || step === 'profile') {
  // 3. @brandthread profile.
  await open('/seller-profile?id=brandthread-official&bt_preview=buyer&demo=1', 'seller-profile-hero');
  await page.waitForTimeout(3000);
  await shot('04-brandthread-profile');
}

if (step === 'all' || step === 'composer') {
  // 4. Composer with the Post-as switch (admin, demo preview).
  await open('/create-post?mode=thread&bt_preview=seller&demo=1&capture=0', 'create-post-screen');
  const photos = [0, 1, 2].map((i) => ({
    name: `p${i}.png`, mimeType: 'image/png', buffer: png(240, 300, [[30, 30, 34], [90, 90, 96], [160, 160, 166]][i]),
  }));
  await page.locator('[data-testid="gallery-file-input"]').setInputFiles(photos);
  await page.getByTestId('gallery-tab-photos').click().catch(() => {});
  await page.waitForTimeout(1500);
  const tiles = page.locator('[data-testid^="gallery-tile-"]');
  for (let i = 0; i < 3; i += 1) await tiles.nth(i).click();
  await page.getByTestId('gallery-next').click();
  await page.getByTestId('slide-editor').waitFor();
  await page.getByTestId('aspect-4x5').click();
  await page.waitForTimeout(800);
  await shot('05-composer-slideshow-4x5');
  await page.getByTestId('edit-next').click();
  await page.getByTestId('post-screen').waitFor();
  await page.getByTestId('caption-input').fill('Rae Urban Sport — the full editorial.');
  await page.getByTestId('switch-post-as-official').click();
  await page.waitForTimeout(400);
  await page.getByTestId('input-credit-handle').fill('lonechryst');
  await page.getByTestId('input-credit-name').fill('LoneChryst / LCT');
  await page.waitForTimeout(800);
  await shot('06-composer-post-as-switch');
}

if (step === 'all' || step === 'bulk') {
  await open('/admin-official-upload?bt_preview=seller&demo=1', 'admin-official-upload');
  await shot('07-admin-bulk-upload');
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="admin-official-upload"]');
    const list = [...root.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 50 && ['auto', 'scroll'].includes(getComputedStyle(d).overflowY));
    const card = document.querySelector('[data-testid="bulk-item-2"]');
    if (list && card) list.scrollTop = card.offsetTop - 12;
  });
  await page.waitForTimeout(800);
  await shot('08-admin-bulk-upload-slideshow');
}

await browser.close();
