import { test } from '@playwright/test';

/**
 * Manual verification screenshots for the shared MediaCropper — app-wide
 * media aspect-ratio system, PR 1 (shared cropper + product photos).
 *
 * Mobbin reference: Instagram's post-creation crop screen (fixed frame,
 * pan/pinch, grid lines while dragging — no aspect-ratio toggle, unlike the
 * stuck PR #251 this supersedes).
 */

async function dismissOverlays(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 3000 }).catch(() => {});
}

test('seller — cropper opens on new product photo, pan/zoom, save @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/products/images', (route) => route.fulfill({ status: 500, body: '{}' }));

  await page.goto('/add-product?bt_preview=seller', { waitUntil: 'networkidle' });
  await page.getByLabel('Step 1: Photos').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByText('Tap to add photos').click();
  const chooser = await chooserPromise;
  await chooser.setFiles('/tmp/test-size-chart-upload.png');

  // Cropper opens automatically for the newly-picked photo.
  await page.getByTestId('media-cropper').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500); // let the source image size resolve
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper/01-cropper-opened.png' });

  // Drag to pan.
  const frame = page.getByTestId('media-cropper').locator('..').locator('div').first();
  await page.mouse.move(195, 400);
  await page.mouse.down();
  await page.mouse.move(195, 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper/02-after-pan.png' });

  // Zoom via the slider.
  const track = page.getByTestId('media-cropper-zoom-track');
  const box = await track.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper/03-after-zoom-slider.png' });

  await page.getByTestId('media-cropper-save').click();
  await page.getByTestId('media-cropper').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper/04-after-save-thumbnail.png' });

  await context.close();
});

test('seller — Edit crop reopens the cropper on an existing photo @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/products/images', (route) => route.fulfill({ status: 500, body: '{}' }));

  await page.goto('/add-product?bt_preview=seller', { waitUntil: 'networkidle' });
  await page.getByLabel('Step 1: Photos').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByText('Tap to add photos').click();
  const chooser = await chooserPromise;
  await chooser.setFiles('/tmp/test-size-chart-upload.png');
  await page.getByTestId('media-cropper').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.getByTestId('media-cropper-save').click();
  await page.getByTestId('media-cropper').waitFor({ state: 'detached', timeout: 5_000 });

  await page.getByText('Edit crop').first().click();
  await page.getByTestId('media-cropper').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper/05-edit-crop-reopened.png' });

  await context.close();
});
