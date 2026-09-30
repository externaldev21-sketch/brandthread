import { test } from '@playwright/test';

/**
 * Live verification for the Seller Studio menu's swipe-down-to-dismiss
 * rewrite: no X close button, swipe-down (mouse drag in this web preview)
 * and tap-outside both trigger the same fast slide-down, and the "View
 * store" pill is no longer covered by anything.
 */

const DIR = 'docs/polish/screenshots/seller-studio-menu-dismiss';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5000';

test('seller studio menu swipe-to-dismiss @ 393x852', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto(`${BASE}/?bt_preview=seller&demo=1`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => {});
  // Dismiss Expo web's dev-only LogBox toast (a pre-existing, unrelated
  // "nested <button>" warning from SellerDashboardSetupCard) — it sits at
  // the bottom of the screen and would otherwise intercept taps. Its small
  // round "×" at the toast's right edge (not the toast body, which expands
  // into a full overlay instead of closing) is the actual dismiss control.
  if (await page.getByText('cannot contain a ne', { exact: false }).first().isVisible().catch(() => false)) {
    await page.mouse.click(309, 817);
    await page.waitForTimeout(300);
  }

  // ── Open ──
  await page.getByLabel('Open Studio tools').click({ timeout: 10_000, force: true });
  await page.getByLabel('Studio tools dark backdrop').waitFor({ timeout: 5000 });
  await page.waitForTimeout(350); // let the ~260ms open animation settle
  await page.screenshot({ path: `${DIR}/01-open.png` });

  // No close (X) button anywhere.
  const closeButtonCount = await page.getByLabel('Close Studio tools').count();
  if (closeButtonCount !== 0) throw new Error(`expected no close button, found ${closeButtonCount}`);

  // ── Mid-drag: swipe down partway without releasing ──
  const viewport = page.viewportSize()!;
  const startX = viewport.width / 2;
  const startY = viewport.height * 0.4;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 40, { steps: 5 });
  await page.mouse.move(startX, startY + 90, { steps: 5 });
  await page.waitForTimeout(50);
  await page.screenshot({ path: `${DIR}/02-mid-drag.png` });

  // Continue the drag past the dismiss threshold and release with a flick.
  await page.mouse.move(startX, startY + 260, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300); // close animation
  await page.screenshot({ path: `${DIR}/03-dismissed-by-swipe.png` });

  // ── Re-open, then dismiss via tap-outside (backdrop) ──
  await page.getByLabel('Open Studio tools').click({ timeout: 10_000 });
  await page.getByLabel('Studio tools dark backdrop').waitFor({ timeout: 5000 });
  await page.waitForTimeout(350);
  // Confirm "View store" pill is clean (nothing overlapping it) before dismissing.
  await page.screenshot({ path: `${DIR}/04-open-view-store-pill.png` });

  await page.getByLabel('Dismiss Studio tools backdrop').click({ position: { x: startX, y: 60 } });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/05-dismissed-by-tap-outside.png` });

  await context.close();
});
