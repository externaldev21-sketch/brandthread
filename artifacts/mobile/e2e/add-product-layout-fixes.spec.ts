import { test } from '@playwright/test';

/**
 * Manual verification screenshots for the add-product layout follow-up
 * (LIVE CHECK on PR #323): the sticky footer (Back/Next) rendered as two
 * tiny squished pills on every step, and the "Options" section header's
 * action ("Add option") floated on its own lower line.
 *
 * Root cause of the footer: PressableScale (components/BrandthreadUI.tsx)
 * only forwards a plain object/array `style` prop to its INNER
 * Animated.View, never to the outer Pressable — so passing `style={{flex:1}}`
 * straight into SecondaryButton/PrimaryButton never reaches the actual flex
 * item in the footer's row; the unstyled outer Pressable shrink-wraps to its
 * label text. Fixed by wrapping each button in its own flex:1 View (the
 * same pattern ProfileButton already uses), not by changing PressableScale
 * itself, which is shared everywhere.
 *
 * Root cause of the header: PressableScale enforces a 44pt minimum touch
 * target on its rendered box unless `noMinHeight` is passed, which SectionHeader's
 * action never did — the invisible tall box read as the action sitting on a
 * lower line next to the shorter title. Fixed by passing `noMinHeight` (kept
 * accessible via the hitSlop already there).
 */

const STEPS = ['Photos', 'Details', 'Variants', 'Pricing', 'Shipping', 'Review'];

async function dismissOverlays(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 3000 }).catch(() => {});
}

test('add-product — sticky footer fixed on every step @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto('/add-product?bt_preview=seller', { waitUntil: 'networkidle' });
  await page.getByLabel('Step 1: Photos').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);

  for (let i = 0; i < STEPS.length; i++) {
    if (i > 0) {
      await page.getByLabel(`Step ${i + 1}: ${STEPS[i]}`).click();
      await page.waitForTimeout(250);
    }
    await page.screenshot({
      path: `docs/polish/screenshots/add-product-layout-fixes/after-step${i + 1}-${STEPS[i].toLowerCase()}.png`,
    });
  }

  await context.close();
});

test('add-product — size chart photo add/replace/remove still works @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/products/images', (route) => route.fulfill({ status: 500, body: '{}' }));

  await page.goto('/add-product?bt_preview=seller', { waitUntil: 'networkidle' });
  await page.getByLabel('Step 1: Photos').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);

  await page.getByLabel('Step 3: Variants').click();
  await page.getByText('Add a size chart photo').waitFor({ timeout: 5_000 });
  await page.screenshot({ path: 'docs/polish/screenshots/add-product-layout-fixes/size-chart-before.png' });

  await page.getByText('Add a size chart photo').click();
  await page.getByText('Choose from Library').waitFor({ timeout: 5_000 });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByText('Choose from Library').click();
  const chooser = await chooserPromise;
  await chooser.setFiles('/tmp/test-size-chart-upload.png');

  await page.getByText('Replace').waitFor({ timeout: 5_000 });
  await page.getByText('Remove').waitFor({ timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/polish/screenshots/add-product-layout-fixes/size-chart-after.png' });

  await context.close();
});

test('buyer — "Size guide" link still opens the zoomable photo sheet @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto('/thread-product-detail?productId=preview-product-01&bt_preview=buyer', { waitUntil: 'networkidle' });
  await page.getByText('Sculpted Wool Coat').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);
  await page.getByTestId('product-size-guide-link').click();
  await page.getByTestId('size-guide-sheet').getByText('Size guide').waitFor({ timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/polish/screenshots/add-product-layout-fixes/buyer-size-guide-sheet.png' });

  await context.close();
});
