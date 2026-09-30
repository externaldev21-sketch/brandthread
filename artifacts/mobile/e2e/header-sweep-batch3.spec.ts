import { test } from '@playwright/test';

/**
 * Live verification for header/notch sweep batch 3 (groups E + F):
 * buyer-drafts, buyer-friend-requests, buyer-highlights-manager,
 * buyer-invite, buyer-order-detail, buyer-other-profile,
 * buyer-post-viewer, buyer-problem-report.
 * (buyer-post-comments only touched its in-file Modal, not the
 * screen's own header, so it's not separately screenshotted here.)
 */

const DIR = 'docs/polish/screenshots/header-sweep-batch3';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5000';

async function shot(page: import('@playwright/test').Page, path: string, name: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/${name}.png` });
}

test('batch 3 screens @ 393x852', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await shot(page, '/buyer-drafts?bt_preview=buyer&demo=1', '01-buyer-drafts');
  await shot(page, '/buyer-friend-requests?bt_preview=buyer&demo=1', '02-buyer-friend-requests');
  await shot(page, '/buyer-highlights-manager?bt_preview=buyer&demo=1', '03-buyer-highlights-manager');
  await shot(page, '/buyer-invite?bt_preview=buyer&demo=1', '04-buyer-invite');
  await shot(page, '/buyer-order-detail?bt_preview=buyer&demo=1&id=preview-order-01', '05-buyer-order-detail');
  await shot(page, '/buyer-other-profile?bt_preview=buyer&demo=1', '06-buyer-other-profile');
  await shot(page, '/buyer-post-viewer?bt_preview=buyer&demo=1', '07-buyer-post-viewer');
  await shot(page, '/buyer-problem-report?bt_preview=buyer&demo=1', '08-buyer-problem-report');

  await context.close();
});
