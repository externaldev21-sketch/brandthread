import { test } from '@playwright/test';

/**
 * Live verification for header/notch sweep batch 2 (groups C + D):
 * ai-studio.tsx, boost.tsx, buyer-archive.tsx, buyer-checkout.tsx,
 * buyer-collection.tsx, buyer-conversation.tsx, app/u/[username].tsx.
 */

const DIR = 'docs/polish/screenshots/header-sweep-batch2';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5000';

async function shot(page: import('@playwright/test').Page, path: string, name: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/${name}.png` });
}

test('batch 2 screens @ 393x852', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await shot(page, '/ai-studio?bt_preview=seller&demo=1', '01-ai-studio');
  await shot(page, '/boost?bt_preview=seller&demo=1', '02-boost');
  await shot(page, '/buyer-archive?bt_preview=seller&demo=1', '03-buyer-archive');
  await shot(page, '/buyer-checkout?bt_preview=buyer&demo=1', '04-buyer-checkout');
  await shot(page, '/buyer-collection?bt_preview=buyer&demo=1', '05-buyer-collection');
  await shot(page, '/buyer-conversation?bt_preview=buyer&demo=1', '06-buyer-conversation');
  await shot(page, '/u/demo-seller?bt_preview=buyer', '07-public-profile');

  await context.close();
});
