import { expect, test } from '@playwright/test';
import { findTextFitIssues } from './helpers/textFit';

/**
 * Text-fit & alignment check for the location page at 393x852 (demo preview).
 * Fails on any truncated label, text that overflows its box, or text cut by
 * the screen edge outside a scrolling row.
 */
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5000';
const SCREENS = [
  '/location/demo?bt_preview=buyer&demo=1',
  '/location/demo?bt_preview=buyer',
];

for (const path of SCREENS) {
  test(`text fits @ 393x852: ${path}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
    const page = await context.newPage();
    await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(800);
    expect(await findTextFitIssues(page)).toEqual([]);
    await context.close();
  });
}
