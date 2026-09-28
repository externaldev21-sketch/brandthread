import { test, expect } from '@playwright/test';

/**
 * Manual verification screenshots for the size-chart-photo feature:
 * a seller adds an optional photo of their own size chart while creating a
 * product (right under the Variants/Sizes section), and a buyer sees a
 * "Size guide" link under the size chips that opens a Glass sheet with the
 * photo, pinch-zoomable.
 *
 * Seller side: no backend runs in this sandbox, so api.products.uploadImage
 * is mocked to fail — the picked photo still shows as the thumbnail
 * immediately (patchDraft sets it before the upload attempt), which is the
 * real behavior on a flaky connection too. This proves the picker → preview
 * → replace/remove UI, not a successful remote upload.
 *
 * Buyer side: uses the real preview catalog (?bt_preview=buyer), which now
 * seeds a real size-chart photo on "Sculpted Wool Coat" — no mocking needed.
 */

async function dismissOverlays(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
}

test('seller — add a size chart photo while creating a product @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/products/images', (route) => route.fulfill({ status: 500, body: '{}' }));

  await page.goto('/add-product?bt_preview=seller', { waitUntil: 'networkidle' });
  await page.getByLabel('Step 1: Photos').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);

  // Jump to the Variants step, where the size chart photo field lives.
  await page.getByLabel('Step 3: Variants').click();
  await page.getByText('Add a size chart photo').waitFor({ timeout: 5_000 });
  await page.screenshot({ path: 'docs/polish/screenshots/size-chart-photo/seller-variants-step-390x844.png' });

  await page.getByText('Add a size chart photo').click();
  await page.getByText('Choose from Library').waitFor({ timeout: 5_000 });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByText('Choose from Library').click();
  const chooser = await chooserPromise;
  await chooser.setFiles('/tmp/test-size-chart-upload.png');

  // The thumbnail shows immediately (local uri set before the upload
  // attempt resolves), with Replace/Remove now available.
  await page.getByText('Replace').waitFor({ timeout: 5_000 });
  await page.getByText('Remove').waitFor({ timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/polish/screenshots/size-chart-photo/seller-photo-added-390x844.png' });

  await context.close();
});

test('buyer — "Size guide" link and zoomable photo sheet @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto('/thread-product-detail?productId=preview-product-01&bt_preview=buyer', { waitUntil: 'networkidle' });
  await page.getByText('Sculpted Wool Coat').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);
  await page.getByTestId('product-size-guide-link').waitFor({ timeout: 5_000 });
  await page.screenshot({ path: 'docs/polish/screenshots/size-chart-photo/buyer-size-guide-link-390x844.png' });

  await page.getByTestId('product-size-guide-link').click();
  await page.getByTestId('size-guide-sheet').getByText('Size guide').waitFor({ timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/polish/screenshots/size-chart-photo/buyer-size-guide-sheet-390x844.png' });

  await context.close();
});
