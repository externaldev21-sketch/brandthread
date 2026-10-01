import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { clerkStubScript } from './clerkStub';
import { findTextFitIssues } from './textFit';

/**
 * Text-fit & alignment pass (393x852) for the shipping & fulfilment screens.
 * Needs Expo web on BASE_URL (default http://127.0.0.1:8081); every API call
 * is mocked, so no backend is required:
 *   BASE_URL=http://127.0.0.1:8081 pnpm exec playwright test -c e2e/playwright.config.ts e2e/text-fit-shipping.spec.ts
 * Fails on any truncated/clipped text, tight padding, or mismatched button
 * row. Screenshots go to SHOT_DIR (default docs/pr-assets/text-fit).
 */
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8081';
const SHOT_DIR = process.env.SHOT_DIR ?? 'docs/pr-assets/text-fit';

const order = {
  id: 'ord-demo-1', orderNumber: 'BT-1042', status: 'processing', totalCents: 9000, subtotalCents: 9000, shippingCents: 0,
  createdAt: '2026-09-28T15:00:00.000Z', buyerName: 'Sam Rivera', guestEmail: 'sam@example.com', sellerDisplayName: 'Acme Studio',
  shippingAddress: { name: 'Sam Rivera', street: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'US' },
  paidAt: '2026-09-28T15:01:00.000Z',
  items: [
    { id: 'item-a', productName: 'Heavyweight tee', variantLabel: 'Black / M', quantity: 1, priceCents: 4500 },
    { id: 'item-b', productName: 'Logo cap', variantLabel: 'Bone', quantity: 1, priceCents: 4500 },
  ],
};

async function prepare(page: Page) {
  await page.addInitScript(clerkStubScript());
  await page.route('**/api/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/package-presets**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/shipping-labels/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ weightLb: 1.2, weightKnown: true, rates: [
      { id: 'r1', carrier: 'USPS', service: 'Ground Advantage', priceCents: 540, currency: 'USD', estimatedDays: 4 },
      { id: 'r2', carrier: 'UPS', service: 'Ground', priceCents: 812, currency: 'USD', estimatedDays: 3 },
    ] }),
  }));
  await page.route('**/api/v1/orders/ord-demo-1', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) }));
  await page.route('**/api/v1/buyer/orders/ord-demo-1', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) }));
}

async function open(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000); // first Metro bundle can be slow
  await page.getByText('Accept all').first().click({ timeout: 500 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function audit(page: Page, name: string) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
  const issues = await findTextFitIssues(page);
  if (issues.length) console.log(`[text-fit] ${name}\n` + issues.map((i) => `  ${i.kind}: "${i.text}" — ${i.detail}`).join('\n'));
  expect(issues, `${name} has text-fit issues`).toEqual([]);
}

const SCREENS: Array<{ name: string; path: string; before?: (page: Page) => Promise<void> }> = [
  { name: 'seller-order-overview', path: '/order-detail?id=ord-demo-1&bt_preview=seller&demo=1' },
  { name: 'seller-order-payment', path: '/order-detail?id=ord-demo-1&tab=payment&bt_preview=seller&demo=1' },
  { name: 'seller-order-fulfillment', path: '/order-detail?id=ord-demo-1&tab=fulfillment&bt_preview=seller&demo=1' },
  {
    name: 'seller-ship-some-sheet', path: '/order-detail?id=ord-demo-1&bt_preview=seller&demo=1',
    before: async (page) => {
      await page.getByText('Ship some items').first().click();
      await page.waitForTimeout(600);
      await page.getByRole('checkbox').first().click();
      await page.waitForTimeout(300);
    },
  },
  { name: 'fulfill-order-package', path: '/fulfill-order?orderId=ord-demo-1&itemIds=item-a&bt_preview=seller&demo=1' },
  { name: 'buyer-order-detail', path: '/buyer-order-detail?id=ord-demo-1&bt_preview=buyer&demo=1' },
];

test.describe('text fit @ 393x852', () => {
  test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
  for (const screen of SCREENS) {
    test(screen.name, async ({ page }) => {
      await prepare(page);
      await open(page, screen.path);
      if (screen.before) await screen.before(page);
      await audit(page, screen.name);
    });
  }
});
