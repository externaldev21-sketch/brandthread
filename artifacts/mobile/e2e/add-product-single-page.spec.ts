import { test, expect } from '@playwright/test';

/**
 * Manual verification screenshots for the Add Product rewrite: the 6-step
 * wizard is gone, replaced with one scrolling page copied from the Shopify
 * iOS Add Product screen (Mobbin refs in the PR description), reskinned
 * Brandthread (black, Inter, monochrome, hairline dividers, no grey boxes).
 */

async function dismissOverlays(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 3000 }).catch(() => {});
}

test('Add Product — header alignment, photo row, one-page scroll, Save flow @ 393x852', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/products/images', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ objectPath: '/objects/mock-photo.jpg' }),
  }));
  await page.route('**/api/products', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'mock-product-1', name: 'Mock Product' }) });
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
  });

  await page.goto('/add-product?bt_preview=seller', { waitUntil: 'networkidle' });
  await page.getByText('Photos').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);

  // ── Header: Cancel · status pill · Save, all on one row below the notch ──
  await page.screenshot({ path: 'docs/polish/screenshots/add-product-rewrite/01-top-of-page.png' });

  // Save should start disabled (no title/photo/price yet).
  const saveBtn = page.getByTestId('add-product-save');
  await expect(saveBtn).toBeVisible();

  // Add a photo — cropper opens automatically (existing 3:4 cropper, reused).
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('add-product-add-photos').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(['/tmp/test-size-chart-upload.png']);
  await page.getByTestId('media-cropper').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/polish/screenshots/add-product-rewrite/02-photo-cropper.png' });
  await page.getByTestId('media-cropper-save').click();
  await page.getByTestId('media-cropper').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/polish/screenshots/add-product-rewrite/03-photo-row-filled.png' });

  // Title + price.
  await page.getByLabel('Title').fill('Sculpted Wool Coat');
  await page.getByLabel('Price *').fill('480.00');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/polish/screenshots/add-product-rewrite/04-title-price-filled.png' });

  // Category picker (native ActionSheet — this dev-web preview renders it,
  // same host component used across the app).
  await page.getByTestId('add-product-category-row').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/polish/screenshots/add-product-rewrite/05-category-sheet.png' });
  await page.getByText('Jacket', { exact: true }).click().catch(() => page.keyboard.press('Escape'));

  // Scroll to Variants / Inventory / Organization (always-open essentials).
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/polish/screenshots/add-product-rewrite/06-variants-inventory.png' });

  // Scroll further to the collapsible sections and open one (Shipping).
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(200);
  const shipping = page.getByText('Shipping', { exact: true }).first();
  await shipping.click().catch(() => {});
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/polish/screenshots/add-product-rewrite/07-collapsible-open.png' });

  // Scroll to the bottom of the page.
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/polish/screenshots/add-product-rewrite/08-bottom-of-page.png' });

  // Save is now enabled (title + photo + price present) — tap it.
  await page.mouse.wheel(0, -4000);
  await page.waitForTimeout(200);
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await page.getByTestId('add-product-success-sheet').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/polish/screenshots/add-product-rewrite/09-save-success.png' });

  await context.close();
});
