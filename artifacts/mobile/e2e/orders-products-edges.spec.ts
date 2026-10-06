import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Nothing white may sit at a screen edge on Orders or Products @ 390×844.
 *
 * Root cause of the old white bar on Orders: SwipeActionRow paints its
 * action panel (Ready = white accent) behind each order card at the row's
 * right edge. Order cards are inset 16px and have a bottom margin, so the
 * panel showed through as a white bar along the right side of the screen.
 * The panel is now transparent until the row is swiped.
 *
 * Runs fresh (signed-out seller preview, every API → []) and with &demo=1
 * order cards (the only way to get cards on screen without an account),
 * with the chip rail at start, mid-scroll and end. Also captures the
 * Dashboard "List your first product" card.
 *
 *   CI=1 EXPO_OFFLINE=1 pnpm exec expo start --web --port 8081
 *   BASE_URL=http://127.0.0.1:8081 pnpm exec playwright test -c e2e/playwright.config.ts e2e/orders-products-edges.spec.ts
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8081';
const DIR = 'docs/polish/screenshots/products-orders-polish';
const VIEWPORT = { width: 390, height: 844 };

async function open(browser: Browser, path: string, demo: boolean, waitFor: string): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(`${BASE}${path}?bt_preview=seller${demo ? '&demo=1' : ''}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  await page.getByTestId(waitFor).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 2000 }).catch(() => {});
  // Hide Expo's dev-only LogBox toast so it can't pollute the edge scan.
  await page.addStyleTag({ content: '[data-testid="logbox_toast"], #logbox-toast { display: none !important; }' }).catch(() => {});
  for (let i = 0; i < 3; i++) {
    if (!(await page.getByText('cannot contain a ne', { exact: false }).first().isVisible().catch(() => false))) break;
    await page.mouse.click(306, 809);
    await page.waitForTimeout(250);
  }
  return page;
}

/** Count near-white pixels in the outer 3 CSS px of each side (skipping the tab bar region is not needed: it is inset). */
async function edgeWhite(page: Page, png: Buffer) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const band = 9; // 3 CSS px @3x
    const count = (x0: number) => {
      const d = ctx.getImageData(x0, 0, band, img.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++;
      return n;
    };
    return { left: count(0), right: count(img.width - band) };
  }, png.toString('base64'));
}

async function setRail(page: Page, where: 'start' | 'mid' | 'end') {
  await page.getByTestId('seller-list-chip-rail').evaluate((node, w) => {
    const el = node as HTMLElement;
    el.style.scrollSnapType = 'none';
    const max = el.scrollWidth - el.clientWidth;
    el.scrollLeft = w === 'start' ? 0 : w === 'mid' ? Math.round(max / 2) : max;
  }, where);
  await page.waitForTimeout(400);
}

async function shoot(page: Page, name: string) {
  const png = await page.screenshot({ path: `${DIR}/${name}.png` });
  const white = await edgeWhite(page, png);
  expect(white, `${name}: white pixels at a screen edge`).toEqual({ left: 0, right: 0 });
}

for (const tab of ['orders', 'products'] as const) {
  for (const demo of [false, true]) {
    if (tab === 'products' && demo) continue; // Products preview list is always empty (previewOnly)
    test(`${tab}${demo ? ' (demo cards)' : ' (fresh)'}: no white at any screen edge, rail start/mid/end`, async ({ browser }) => {
      const page = await open(browser, `/${tab}`, demo, 'seller-list-chip-rail');
      for (const where of ['start', 'mid', 'end'] as const) {
        await setRail(page, where);
        await shoot(page, `edge-${tab}-${demo ? 'demo' : 'fresh'}-rail-${where}`);
      }
    });
  }
}

test('dashboard: "List your first product" card starts at the title', async ({ browser }) => {
  const page = await open(browser, '/', false, 'seller-dashboard-setup-card');
  const card = page.getByTestId('seller-dashboard-setup-card');
  await card.scrollIntoViewIfNeeded();
  const geo = await card.evaluate((node) => {
    const el = node as HTMLElement;
    const title = Array.from(el.querySelectorAll('div')).find((d) => d.textContent === 'List your first product')!;
    return { cardTop: el.getBoundingClientRect().top, titleTop: title.getBoundingClientRect().top, svgs: el.querySelectorAll('svg').length };
  });
  // No icon tile: the only glyph left is the button's "+".
  expect(geo.svgs).toBeLessThanOrEqual(1);
  expect(geo.titleTop - geo.cardTop).toBeLessThanOrEqual(24);
  await page.screenshot({ path: `${DIR}/dashboard-setup-card.png` });
  await card.screenshot({ path: `${DIR}/zoom-dashboard-setup-card.png` });
});
