import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * "Back = black screen / jumps to a random page" (owner report). Every case
 * here was reproduced failing on dev before the fix; see the PR body for
 * the before/after table.
 *
 *   CI=1 EXPO_OFFLINE=1 pnpm exec expo start --web --port 8081
 *   BASE_URL=http://127.0.0.1:8081 pnpm exec playwright test -c e2e/playwright.config.ts e2e/back-navigation-destinations.spec.ts
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8081';

async function open(browser: Browser, role: 'seller' | 'buyer', path = '/'): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(`${BASE}${path}?bt_preview=${role}&demo=1`, { waitUntil: 'networkidle', timeout: 120_000 }).catch(() => {});
  await page.getByTestId(role === 'seller' ? 'seller-global-tab-bar' : 'buyer-bottom-tab-bar').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 1500 }).catch(() => {});
  // Expo web's dev-only LogBox toast sits over the tab bar.
  await page.addStyleTag({ content: '#error-toast{display:none!important}' });
  await page.getByTestId('feed-gesture-guide-dismiss').click({ timeout: 1500 }).catch(() => {});
  return page;
}

const pathOf = (page: Page) => new URL(page.url()).pathname;

async function waitForPath(page: Page, pathname: string) {
  await expect.poll(() => pathOf(page), { timeout: 10_000 }).toBe(pathname);
}

async function tapBack(page: Page) {
  // The in-app header control ("Go back from Payouts", "Close bag"…), never browser history.
  const back = page.getByRole('button', { name: /^(Go back( from .+)?|Back|Close( bag)?)$/i }).filter({ visible: true }).first();
  await back.click({ timeout: 5000 });
  await page.waitForTimeout(1300);
}

/** Opens the Studio menu, holds a scrub `steps` cards to the left, releases
 *  (release-to-select auto-enters the landed card). */
async function openStudioCard(page: Page, steps: number) {
  await page.getByLabel('Open Studio tools').click();
  await page.getByTestId('seller-studio-card-area').waitFor();
  await page.waitForTimeout(700);
  let x = 300;
  await page.mouse.move(x, 422);
  await page.mouse.down();
  for (let i = 0; i < steps; i++) {
    x -= 60;
    await page.mouse.move(x, 422, { steps: 6 });
    await page.waitForTimeout(220);
  }
  await page.waitForTimeout(160);
  await page.mouse.up();
  await page.waitForTimeout(2500);
}

/** The card actually painted under the screen centre (null = empty/black). */
async function centredStudioCard(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    const card = Array.from(document.querySelectorAll('[data-testid^="seller-control-center-item-"]')).find((c) => {
      const r = c.getBoundingClientRect();
      return r.left < cx && r.right > cx && r.top < cy && r.bottom > cy && getComputedStyle(c).opacity !== '0';
    });
    return card?.getAttribute('data-testid')?.replace('seller-control-center-item-', '') ?? null;
  });
}

// ─── Seller: Studio menu → page → back ───────────────────────────────────────

for (const [steps, route, card] of [
  [2, '/analytics', 'analytics'],
  [3, '/payouts', 'payouts'],
] as const) {
  for (const tab of ['/', '/products'] as const) {
    test(`${tab} → Studio → ${card} → back ⇒ ${tab} with the ${card} card showing`, async ({ browser }) => {
      const page = await open(browser, 'seller', tab);
      await openStudioCard(page, steps);
      await waitForPath(page, route);
      await tapBack(page);
      await waitForPath(page, tab);
      await expect(page.getByTestId('seller-studio-card-area')).toBeVisible();
      expect(await centredStudioCard(page)).toBe(card);
    });
  }
}

test('Studio → design tool → back ⇒ same tab with a card showing', async ({ browser }) => {
  const page = await open(browser, 'seller', '/products');
  await openStudioCard(page, 5);
  expect(pathOf(page)).toMatch(/^\/design/);
  await tapBack(page);
  await waitForPath(page, '/products');
  expect(await centredStudioCard(page)).not.toBeNull();
});

// ─── Buyer ───────────────────────────────────────────────────────────────────

test('profile → Edit profile → back ⇒ profile (not Home)', async ({ browser }) => {
  const page = await open(browser, 'buyer');
  await page.getByTestId('buyer-tab-profile').click();
  await waitForPath(page, '/profile');
  await page.getByTestId('profile-edit-button').filter({ visible: true }).first().click();
  await waitForPath(page, '/edit-profile');
  await tapBack(page);
  await waitForPath(page, '/profile');
});

test('profile → menu → Find friends → back ⇒ profile (not Home)', async ({ browser }) => {
  const page = await open(browser, 'buyer');
  await page.getByTestId('buyer-tab-profile').click();
  await page.getByTestId('buyer-profile-more').filter({ visible: true }).first().click();
  await page.getByText(/^Find friends$/).filter({ visible: true }).first().click();
  await waitForPath(page, '/friends');
  // Friends is a hidden tab with no header back; this is the Android/browser back.
  await page.goBack();
  await waitForPath(page, '/profile');
});

test('profile → menu → Orders opens the orders screen (not "Not found")', async ({ browser }) => {
  const page = await open(browser, 'buyer');
  await page.getByTestId('buyer-tab-profile').click();
  await page.getByTestId('buyer-profile-more').filter({ visible: true }).first().click();
  await page.getByText(/^Orders$/).filter({ visible: true }).first().click();
  await waitForPath(page, '/orders');
  await expect(page.getByText("This screen doesn't exist")).toHaveCount(0);
});

test('discover → video → bag → close ⇒ the video (not Home)', async ({ browser }) => {
  const page = await open(browser, 'buyer', '/discover');
  const tile = page.locator('[data-testid^="discover-tile-video-"]').filter({ visible: true }).first();
  await tile.waitFor({ timeout: 20_000 });
  const box = (await tile.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await waitForPath(page, '/discover-player');
  // The player's bag icon keeps animating, so it never reads as "stable".
  await page.getByLabel(/^Open bag/).filter({ visible: true }).first().dispatchEvent('click');
  await waitForPath(page, '/cart');
  await tapBack(page);
  await waitForPath(page, '/discover-player');
});
