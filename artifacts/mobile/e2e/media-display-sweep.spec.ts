import { test } from '@playwright/test';

/**
 * Manual verification screenshots for PR 3 (display sweep) of the app-wide
 * media aspect-ratio system: every surface that shows a saved 3:4 photo
 * (Discover tiles/viewer, profile grid, product detail gallery, chat
 * product card) now shows the creator's full chosen crop — no more
 * center-cropping into a shape that doesn't match. Videos/story posters
 * are unchanged (still full-bleed cover where shown as a thumbnail).
 */

async function dismissOverlays(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 3000 }).catch(() => {});
}

test('Discover grid + post viewer show photos uncropped @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/discover?bt_preview=buyer', { waitUntil: 'networkidle' });
  await dismissOverlays(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'docs/polish/screenshots/media-display-sweep/01-discover-grid.png' });

  const tile = page.locator('[data-testid^="discover-tile-"]').first();
  if (await tile.count() > 0) {
    await tile.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'docs/polish/screenshots/media-display-sweep/02-discover-viewer.png' });
  }
  await context.close();
});

test('Profile grid shows photo/slideshow tiles uncropped @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/buyer-other-profile?bt_preview=buyer&userId=preview-seller-05', { waitUntil: 'networkidle' });
  await dismissOverlays(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'docs/polish/screenshots/media-display-sweep/03-profile-grid.png' });
  await context.close();
});

test('Product detail gallery shows the full 3:4 photo @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/thread-product-detail?bt_preview=buyer&productId=preview-product-01', { waitUntil: 'networkidle' });
  await dismissOverlays(page);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'docs/polish/screenshots/media-display-sweep/04-product-detail.png' });
  await context.close();
});

test('Chat attachment card shows the full 3:4 product photo @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('/inbox?bt_preview=buyer', { waitUntil: 'networkidle' });
  await dismissOverlays(page);
  await page.waitForTimeout(1000);
  const row = page.locator('[data-testid^="inbox-conversation-"]').first();
  if (await row.count() > 0) {
    await row.click();
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: 'docs/polish/screenshots/media-display-sweep/05-chat-attachment-card.png' });
  await context.close();
});
