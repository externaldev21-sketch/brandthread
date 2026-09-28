import { test } from '@playwright/test';

/**
 * Manual verification screenshots for the shared MediaCropper wired into
 * PR 2 (post creation + story) of the app-wide media aspect-ratio system.
 *
 * Mobbin reference: same Instagram post-creation "Adjust" crop screen cited
 * in PR 1 (fixed frame, grid lines while dragging, pinch/pan) — reused here
 * unchanged for the photo-post crop step; the story flow uses the same
 * component with a 9:16 frame, matching Instagram's story capture frame.
 */

async function dismissOverlays(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 3000 }).catch(() => {});
}

test('create-post — photo crops to 3:4 on pick, "Crop" tool re-opens it in slide-edit @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto('/create-post?bt_preview=seller', { waitUntil: 'networkidle' });
  await page.getByText('New Thread').waitFor({ timeout: 20_000 });
  await dismissOverlays(page);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByLabel('Choose from files').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(['/tmp/test-size-chart-upload.png']);

  // Cropper opens automatically for the newly-picked photo, 3:4.
  await page.getByTestId('media-cropper').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper-post/01-cropper-opened.png' });

  // Pan.
  await page.mouse.move(195, 400);
  await page.mouse.down();
  await page.mouse.move(195, 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper-post/02-after-pan.png' });

  await page.getByTestId('media-cropper-save').click();
  await page.getByTestId('media-cropper').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper-post/03-back-on-media-pick.png' });

  // Proceed to slide-edit.
  await page.getByTestId('picker-next-btn').click();
  await page.getByTestId('slide-tool-crop').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper-post/04-slide-edit.png' });

  // "Crop" tool chip re-opens the cropper, framed where the photo was left.
  await page.getByTestId('slide-tool-crop').click();
  await page.getByTestId('media-cropper').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper-post/05-edit-crop-reopened.png' });

  await context.close();
});

test('story — photo crops to 9:16 on pick @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto('/buyer-story-create?bt_preview=buyer', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose from camera roll').waitFor({ timeout: 20_000 });
  await dismissOverlays(page);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByLabel('Choose from camera roll').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(['/tmp/test-size-chart-upload.png']);

  // Cropper opens automatically, 9:16 frame.
  await page.getByTestId('media-cropper').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper-story/01-cropper-opened-9x16.png' });

  // Zoom via the slider.
  const track = page.getByTestId('media-cropper-zoom-track');
  const box = await track.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper-story/02-after-zoom.png' });

  await page.getByTestId('media-cropper-save').click();
  await page.getByTestId('media-cropper').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/polish/screenshots/media-cropper-story/03-edit-step-cropped.png' });

  await context.close();
});
