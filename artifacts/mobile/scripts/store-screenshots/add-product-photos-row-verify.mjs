/**
 * Add Product — Photos row verification (Dev's spec): true 1:1 square
 * tiles, 3 default empty "Add photo" slots (solid hairline border, no
 * dashed placeholder), a quiet "+" tile that stages one more empty slot per
 * tap (up to 10), filled slots edge-to-edge with a remove X, subtle "n/10"
 * counter.
 *
 * Captures empty / 2 filled / 5 filled (scrolling) / 10 filled at 393x852.
 *
 * Run:  node scripts/store-screenshots/add-product-photos-row-verify.mjs
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { clerkStubScript } from './clerk-stub.mjs';
import { DEMO_NOW, DEMO_TIME_ZONE, SELLER_USER, localStorageSeed, respond } from './demo-data.mjs';
import { MOBILE_ROOT, buildPreviewWeb, launchBrowser, serveBuild } from './harness.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/polish/screenshots/add-product-photos-row');
mkdirSync(OUT, { recursive: true });

const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 3,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const DEMO_API = 'https://api.brandthread.test';
// A tiny valid 1x1 JPEG, reused as every picked "photo" so no real image
// library access is needed inside the headless browser.
const FAKE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLFRgTEQ4dHR8bGBQVFR4pIRwjKykpJi01Pi01LVBLTU9WV1lZWVlZWVn/2wBDAQkJCQwLDBYPDxYaFRUVGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhr/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/AKAP/9k=',
  'base64',
);

const RANGES = [];

async function main() {
  console.log('Building web preview…');
  buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();

  try {
    const context = await browser.newContext({
      viewport: DEVICE.viewport,
      deviceScaleFactor: DEVICE.scale,
      isMobile: DEVICE.isMobile,
      hasTouch: DEVICE.isMobile,
      userAgent: DEVICE.userAgent,
      locale: 'en-US',
      timezoneId: DEMO_TIME_ZONE,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    await context.clock.install({ time: DEMO_NOW });
    await context.addInitScript(clerkStubScript(SELLER_USER));
    await context.addInitScript((seed) => {
      if (sessionStorage.getItem('bt:screenshot-seeded')) return;
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
      sessionStorage.setItem('bt:screenshot-seeded', '1');
    }, localStorageSeed('seller', {}));

    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin) return route.continue();
      if (url.origin === DEMO_API) {
        const cors = {
          'access-control-allow-origin': origin,
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': 'authorization,content-type,x-store-context',
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (url.pathname === '/api/products/images' && request.method() === 'POST') {
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ objectPath: '/objects/mock-photo.jpg' }) });
        }
        const body = respond({ method: request.method(), path: url.pathname, query: url.searchParams, role: 'seller', options: {} });
        if (body === undefined) {
          return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"code":"NOT_SEEDED","message":"Not part of the demo data"}}' });
        }
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
      }
      return route.abort();
    });

    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console.error]', msg.text()); });
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));
    await page.goto(`${origin}/add-product?bt_preview=seller`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await page.getByText('Photos').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);

    async function addPhotoAt(testId) {
      const chooserPromise = page.waitForEvent('filechooser');
      await page.getByTestId(testId).first().click();
      const chooser = await chooserPromise;
      const tmp = path.join(MOBILE_ROOT, '.store-screenshots', `photo-row-fake-${Date.now()}.jpg`);
      await import('node:fs').then((fs) => fs.writeFileSync(tmp, FAKE_JPEG));
      await chooser.setFiles([tmp]);
      // Cropper opens automatically — accept the default crop.
      await page.getByTestId('media-cropper').waitFor({ timeout: 10_000 });
      await page.getByTestId('media-cropper-save').click();
      await page.getByTestId('media-cropper').waitFor({ state: 'detached', timeout: 5_000 });
      await page.waitForTimeout(400);
    }

    // ── Empty ──
    await page.screenshot({ path: path.join(OUT, '01-empty.png') });
    console.log('captured 01-empty.png');

    // ── 2 filled ──
    await addPhotoAt('add-product-add-photos');
    await addPhotoAt('add-product-add-photos');
    await page.screenshot({ path: path.join(OUT, '02-two-filled.png') });
    console.log('captured 02-two-filled.png');

    // ── 5 filled (scrolling) — tap "+" twice to stage 2 more slots, fill all ──
    await page.getByTestId('add-product-add-slot').click();
    await page.getByTestId('add-product-add-slot').click();
    await addPhotoAt('add-product-add-photos');
    await addPhotoAt('add-product-add-photos');
    await addPhotoAt('add-product-add-photos');
    await page.screenshot({ path: path.join(OUT, '03-five-filled.png') });
    console.log('captured 03-five-filled.png');

    // ── 10 filled — stage the remaining slots and fill them; "+" disappears ──
    for (let i = 0; i < 5; i++) {
      const plus = page.getByTestId('add-product-add-slot');
      if (await plus.count() === 0) break;
      await plus.click();
    }
    for (let i = 0; i < 5; i++) {
      await addPhotoAt('add-product-add-photos');
    }
    await page.screenshot({ path: path.join(OUT, '04-ten-filled.png') });
    console.log('captured 04-ten-filled.png');

    const plusStillThere = await page.getByTestId('add-product-add-slot').count();
    console.log(`"+" tile present at 10/10: ${plusStillThere > 0} (expected false)`);

    await context.close();
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
