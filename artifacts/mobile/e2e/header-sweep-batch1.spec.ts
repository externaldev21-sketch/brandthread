import { test } from '@playwright/test';

/**
 * Live verification for header/notch sweep batch 1 (files starting with
 * a/b, first ~19 of ~82): every screen below now uses the shared
 * components/ScreenHeader.tsx instead of a hand-rolled header, and every
 * in-file <Modal> is wrapped in components/ModalSafeArea.tsx.
 */

const DIR = 'docs/polish/screenshots/header-sweep-batch1';

async function shot(page: import('@playwright/test').Page, path: string, name: string) {
  await page.goto(path, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/${name}.png` });
}

test('batch 1 screens @ 393x852', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await shot(page, '/analytics?bt_preview=seller&demo=1', '01-tabs-analytics');
  await shot(page, '/this-route-does-not-exist-xyz', '02-not-found');
  await shot(page, '/account-type-settings?bt_preview=buyer', '03-account-type-settings');
  await shot(page, '/activity-center?bt_preview=seller&demo=1', '04-activity-center');
  await shot(page, '/activity-people?bt_preview=buyer&type=followers&ids=', '05-activity-people');
  await shot(page, '/admin-reports?bt_preview=seller', '06-admin-reports');
  await shot(page, '/ai-brain?bt_preview=seller', '07-ai-brain');
  await shot(page, '/app-theme?bt_preview=seller', '08-app-theme');
  await shot(page, '/biometric-unlock?bt_preview=buyer', '09-biometric-unlock');
  await shot(page, '/analytics-content?bt_preview=seller&demo=1', '10-analytics-content');
  await shot(page, '/analytics-customers?bt_preview=seller&demo=1', '11-analytics-customers');
  await shot(page, '/analytics-inventory?bt_preview=seller&demo=1', '12-analytics-inventory');
  await shot(page, '/analytics-marketing?bt_preview=seller&demo=1', '13-analytics-marketing');
  await shot(page, '/analytics-production?bt_preview=seller&demo=1', '14-analytics-production');
  await shot(page, '/analytics-products?bt_preview=seller&demo=1', '15-analytics-products');
  await shot(page, '/analytics-profit?bt_preview=seller&demo=1', '16-analytics-profit');
  await shot(page, '/analytics-sales?bt_preview=seller&demo=1', '17-analytics-sales');
  await shot(page, '/analytics-store?bt_preview=seller&demo=1', '18-analytics-store');

  // admin-reports: try to open the review-detail modal too (best effort —
  // depends on demo data actually producing a queue row).
  await page.goto('/admin-reports?bt_preview=seller&demo=1', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(700);
  const row = page.locator('[role="button"], button, [data-testid]').filter({ hasText: /review|report/i }).first();
  await row.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/19-admin-reports-modal-attempt.png` });

  await context.close();
});
