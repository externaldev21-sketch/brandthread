import { test } from '@playwright/test';

/**
 * Manual verification: the "Track inventory" switch (and app-wide switches)
 * no longer show react-native-web's default teal (#009688) thumb when on —
 * they use the shared HapticSwitch wrapper, which mirrors thumbColor into
 * activeThumbColor so web matches native.
 */

async function dismissOverlays(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 3000 }).catch(() => {});
}

test('Add Product — Track inventory switch is monochrome (not teal) when on @ 393x852', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.goto('/add-product?bt_preview=seller', { waitUntil: 'networkidle' });
  await page.getByText('Photos').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);

  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/polish/screenshots/monochrome-switch-fix/01-inventory-switch-on-default.png' });

  // Toggle "Allow overselling" (starts off) to on, to see the "on" thumb color.
  const oversellSwitch = page.getByText('Allow overselling').locator('..').locator('[role="switch"], input[type="checkbox"]').first();
  await oversellSwitch.click({ force: true }).catch(async () => {
    // Fallback: RN Switch on web renders as a checkbox; click its row.
    await page.getByText('Allow overselling').click();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/polish/screenshots/monochrome-switch-fix/02-allow-overselling-toggled-on.png' });

  await context.close();
});
