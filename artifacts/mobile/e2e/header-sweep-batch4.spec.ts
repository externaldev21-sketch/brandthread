import { test } from '@playwright/test';

/**
 * Live verification for header/notch sweep batch 4 (final batch, groups G + H):
 * buyer-qr-code, buyer-refund-request, buyer-report, buyer-restricted,
 * buyer-return-request, buyer-saved, buyer-settings-menu,
 * buyer-story-create, buyer-story-viewer, c/[collectionId].
 */

const DIR = 'docs/polish/screenshots/header-sweep-batch4';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5000';

async function shot(page: import('@playwright/test').Page, path: string, name: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/${name}.png` });
}

test('batch 4 screens @ 393x852', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await shot(page, '/buyer-qr-code?bt_preview=buyer&demo=1', '01-buyer-qr-code');
  await shot(page, '/buyer-refund-request?bt_preview=buyer&demo=1&orderId=preview-order-01', '02-buyer-refund-request');
  await shot(page, '/buyer-report?bt_preview=buyer&demo=1&targetId=1&targetType=post', '03-buyer-report');
  await shot(page, '/buyer-restricted?bt_preview=buyer&demo=1', '04-buyer-restricted');
  await shot(page, '/buyer-return-request?bt_preview=buyer&demo=1&orderId=preview-order-01', '05-buyer-return-request');
  await shot(page, '/buyer-saved?bt_preview=buyer&demo=1', '06-buyer-saved');
  await shot(page, '/buyer-settings-menu?bt_preview=buyer&demo=1', '07-buyer-settings-menu');
  await shot(page, '/buyer-story-create?bt_preview=buyer&demo=1', '08-buyer-story-create');
  await shot(page, '/c/demo-collection?bt_preview=buyer', '09-public-collection');

  await context.close();
});
