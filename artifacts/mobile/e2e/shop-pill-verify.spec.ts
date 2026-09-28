import { test, expect } from '@playwright/test';
import { clerkStubScript } from './clerkStub';

/**
 * Manual/local verification for the SHOP side-tab polish pass: the pill's
 * glass fill (`<Glass/>` + `noBlur`), its product-count badge, and the
 * smooth open of `ShopProductSheet`'s multi-tag "Shop the post" sheet — see
 * the PR description for the Mobbin reference this was built against.
 *
 * Not run in CI (same as the other specs in this directory) — needs the
 * dev-web `?bt_preview=buyer` bypass served locally. Run the same way as
 * feed-top-row-overlap.spec.ts:
 *   EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=<any syntactically-valid dummy key> \
 *   pnpm exec expo start --web --port 8081   # from artifacts/mobile
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers BASE_URL=http://127.0.0.1:8081 \
 *   pnpm exec playwright test e2e/shop-pill-verify.spec.ts -c e2e/playwright.config.ts
 */
test('SHOP pill: glass fill, count badge, slide-in sheet', async ({ page }) => {
  await page.addInitScript(clerkStubScript());
  await page.goto('/?bt_preview=buyer', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await page.waitForTimeout(2500);

  await page.screenshot({ path: 'e2e/__screenshots__/shop-pill-01-feed.png' });

  // The first-run gesture-guide overlay (unrelated to this change) sits on
  // top of the feed the first time preview data loads — dismiss it the same
  // way a real first-time viewer would (tap anywhere on it) before poking
  // at the pill underneath.
  const gestureGuide = page.getByTestId('feed-gesture-guide');
  if (await gestureGuide.isVisible().catch(() => false)) {
    await gestureGuide.click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(400);
  }

  // FlatList virtualization mounts more than one page's pill off-screen —
  // the first (top/active) page's is what's actually visible.
  const pill = page.getByTestId('shop-tag-pill').first();
  await expect(pill).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'e2e/__screenshots__/shop-pill-02-collapsed.png', clip: { x: 0, y: 300, width: 160, height: 300 } });

  // Tap 1: collapsed -> expanded strip (name/price/count).
  await pill.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/__screenshots__/shop-pill-03-expanded.png', clip: { x: 0, y: 300, width: 320, height: 300 } });

  // Tap 2 (on the now-expanded strip): opens ShopProductSheet.
  await pill.click();
  await page.waitForTimeout(90);
  await page.screenshot({ path: 'e2e/__screenshots__/shop-pill-04-sheet-mid.png' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/__screenshots__/shop-pill-05-sheet-open.png' });
});
