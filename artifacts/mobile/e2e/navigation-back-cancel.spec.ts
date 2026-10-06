import { expect, test, type Browser, type Page } from '@playwright/test';
import { collectTextOverflow, countVisibleTextNodes } from './textFit';

/**
 * Back / Cancel / X contract (docs/NAVIGATION.md): every exit returns the
 * seller to the exact screen (and tab) they came from, and leaving a flow
 * never switches tabs or opens the Studio menu.
 *
 * Runs against the Expo web dev server in the seller preview:
 *   CI=1 EXPO_OFFLINE=1 pnpm exec expo start --web --port 8081
 *   BASE_URL=http://127.0.0.1:8081 pnpm exec playwright test -c e2e/playwright.config.ts e2e/navigation-back-cancel.spec.ts
 *
 * The API is stubbed with empty lists so every flow is deterministic; the
 * demo dataset (`&demo=1`) still seeds the local preview orders/analytics.
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8081';
const DIR = 'docs/polish/screenshots/navigation-back-cancel';

async function openSeller(browser: Browser, path = '/'): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  const sep = path.includes('?') ? '&' : '?';
  await page.goto(`${BASE}${path}${sep}bt_preview=seller&demo=1`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  await page.getByTestId('seller-global-tab-bar').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 2000 }).catch(() => {});
  await dismissLogBox(page);
  return page;
}

/** Expo web's dev-only LogBox toast (a pre-existing nested-<button> warning
 *  from the dashboard setup card) sits over the tab bar; its small "×" at the
 *  right edge is the only control that closes it. */
async function dismissLogBox(page: Page) {
  for (let i = 0; i < 3; i++) {
    const toast = page.getByText('cannot contain a ne', { exact: false }).first();
    if (!(await toast.isVisible().catch(() => false))) return;
    await page.mouse.click(309, 817);
    await page.waitForTimeout(250);
  }
}

function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

async function expectMenuClosed(page: Page) {
  await expect(page.getByTestId('seller-studio-card-area')).toHaveCount(0);
  await expect(page.getByLabel('Open Studio tools')).toBeVisible();
}

async function expectMenuOpen(page: Page) {
  await expect(page.getByTestId('seller-studio-card-area')).toBeVisible();
  await expect(page.getByTestId('seller-bottom-menu')).toHaveAttribute('aria-label', 'Close Studio tools');
}

async function expectDashboard(page: Page) {
  expect(pathOf(page)).toBe('/');
  // `.first()`: the card is a pre-existing nested <button> on web (two matches).
  await expect(page.getByTestId('seller-dashboard-setup-card').first()).toBeVisible();
  await expect(page.getByTestId('seller-tab-index')).toHaveAttribute('aria-selected', 'true');
  await expectMenuClosed(page);
}

async function expectTab(page: Page, tab: 'products' | 'orders' | 'profile') {
  expect(pathOf(page)).toBe(`/${tab}`);
  await expect(page.getByTestId(`seller-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
  await expectMenuClosed(page);
}

async function goToTab(page: Page, tab: 'products' | 'orders' | 'profile') {
  await page.getByTestId(`seller-tab-${tab}`).click();
  await page.waitForTimeout(700);
  await expectTab(page, tab);
}

/** The bare back chevron / Close control of the pushed screen's header. */
async function tapBack(page: Page) {
  const back = page.getByRole('button', { name: /^(Go back|Back|Close)/ }).first();
  await back.waitFor({ timeout: 10_000 });
  // create-post's header title text sits over its Close hit-area in the web
  // preview (react-native-web layering only); a synthetic click reaches the
  // same Pressable handler a real tap does.
  await back.click({ timeout: 3000 }).catch(() => back.dispatchEvent('click'));
  await page.waitForTimeout(700);
}

async function openStudio(page: Page) {
  await page.getByLabel('Open Studio tools').click({ timeout: 10_000 });
  await page.getByTestId('seller-studio-card-area').waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);
  await expectMenuOpen(page);
}

/** Tap-to-open on the centred card (the menu opens on "Create post"). */
async function openFirstStudioCard(page: Page) {
  const area = page.getByTestId('seller-studio-card-area');
  const box = (await area.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(900);
}

async function waitForPath(page: Page, pathname: string) {
  await expect.poll(() => pathOf(page), { timeout: 10_000 }).toBe(pathname);
  await page.waitForTimeout(400);
}

// ─── Dashboard → Add product ─────────────────────────────────────────────────

test('dashboard → Add a product → Cancel ⇒ dashboard', async ({ browser }) => {
  const page = await openSeller(browser);
  await expectDashboard(page);
  await page.getByRole('button', { name: 'Add a product' }).first().click();
  await waitForPath(page, '/add-product');
  // Straight into the flow, carrying its origin — no intermediate products page.
  expect(new URL(page.url()).searchParams.get('from')).toBe('dashboard');
  await page.screenshot({ path: `${DIR}/01-dashboard-add-product.png` });
  await page.getByTestId('add-product-exit').click();
  await waitForPath(page, '/');
  await expectDashboard(page);
  await page.screenshot({ path: `${DIR}/02-dashboard-after-cancel.png` });
});

test('dashboard → Add a product → hardware/swipe back ⇒ dashboard', async ({ browser }) => {
  // add-product has no X; the hardware/browser back and iOS swipe-back pop the
  // same single level the Cancel button does.
  const page = await openSeller(browser);
  await page.getByRole('button', { name: 'Add a product' }).first().click();
  await waitForPath(page, '/add-product');
  await page.goBack();
  await waitForPath(page, '/');
  await expectDashboard(page);
});

test('dashboard → Add a product → Cancel never re-opens a previously used Studio menu', async ({ browser }) => {
  // Regression: the Studio menu is unmounted on the full-screen add-product
  // route; on remount it used to see its stale open request and expand by
  // itself, so Cancel "dumped the seller on the menu".
  const page = await openSeller(browser);
  await openStudio(page);
  await page.getByTestId('seller-studio-menu-close').click();
  await page.waitForTimeout(500);
  await expectMenuClosed(page);
  await page.getByRole('button', { name: 'Add a product' }).first().click();
  await waitForPath(page, '/add-product');
  await page.getByTestId('add-product-exit').click();
  await waitForPath(page, '/');
  await expectDashboard(page);
  await page.screenshot({ path: `${DIR}/03-dashboard-after-cancel-menu-used-before.png` });
});

test('dashboard → Add a product → tap Dashboard tab ⇒ dashboard (active tab pops to root)', async ({ browser }) => {
  const page = await openSeller(browser);
  await page.getByRole('button', { name: 'Add a product' }).first().click();
  await waitForPath(page, '/add-product');
  // add-product hides the bar; the tab is still in the DOM and navigable.
  await page.getByTestId('seller-tab-index').click({ force: true });
  await waitForPath(page, '/');
  await expectDashboard(page);
});

// ─── Studio menu ─────────────────────────────────────────────────────────────

test('menu → tile → back ⇒ menu', async ({ browser }) => {
  const page = await openSeller(browser);
  await openStudio(page);
  await page.screenshot({ path: `${DIR}/04-menu-open.png` });
  await openFirstStudioCard(page);
  await waitForPath(page, '/create-post');
  await page.screenshot({ path: `${DIR}/05-menu-tile.png` });
  await tapBack(page);
  await waitForPath(page, '/');
  await expectMenuOpen(page);
  await page.screenshot({ path: `${DIR}/06-menu-reopened-after-back.png` });
});

test('menu → tile → tap a tab ⇒ that tab, menu stays closed', async ({ browser }) => {
  const page = await openSeller(browser);
  await openStudio(page);
  await openFirstStudioCard(page);
  await waitForPath(page, '/create-post');
  await page.getByTestId('seller-tab-products').click({ force: true });
  await waitForPath(page, '/products');
  await expectTab(page, 'products');
});

// ─── Products tab ────────────────────────────────────────────────────────────

test('products tab → Add product → Cancel ⇒ products tab', async ({ browser }) => {
  const page = await openSeller(browser);
  await goToTab(page, 'products');
  await page.getByRole('button', { name: 'Add product' }).click();
  await waitForPath(page, '/add-product');
  await page.screenshot({ path: `${DIR}/07-products-add-product.png` });
  await page.getByTestId('add-product-exit').click();
  await waitForPath(page, '/products');
  await expectTab(page, 'products');
  await page.screenshot({ path: `${DIR}/08-products-after-cancel.png` });
});

test('products tab → Add product → hardware/swipe back ⇒ products tab', async ({ browser }) => {
  const page = await openSeller(browser);
  await goToTab(page, 'products');
  await page.getByRole('button', { name: 'Add product' }).click();
  await waitForPath(page, '/add-product');
  await page.goBack();
  await waitForPath(page, '/products');
  await expectTab(page, 'products');
});

// ─── Other common entry / exit pairs ─────────────────────────────────────────

test('dashboard → traffic analytics → back ⇒ dashboard', async ({ browser }) => {
  const page = await openSeller(browser);
  await page.getByRole('button', { name: 'See all traffic analytics' }).click();
  await waitForPath(page, '/analytics-store');
  await tapBack(page);
  await waitForPath(page, '/');
  await expectDashboard(page);
});

test('dashboard → activity → back ⇒ dashboard', async ({ browser }) => {
  const page = await openSeller(browser);
  await page.getByRole('button', { name: 'Activity' }).click();
  await waitForPath(page, '/activity-center');
  await tapBack(page);
  await waitForPath(page, '/');
  await expectDashboard(page);
});

test('profile tab → Edit profile → back ⇒ profile tab', async ({ browser }) => {
  const page = await openSeller(browser);
  await goToTab(page, 'profile');
  await page.getByRole('button', { name: /^Edit profile/ }).first().click();
  await waitForPath(page, '/edit-profile');
  await tapBack(page);
  await waitForPath(page, '/profile');
  await expectTab(page, 'profile');
});

test('orders tab → order → back ⇒ orders tab', async ({ browser }) => {
  const page = await openSeller(browser);
  await goToTab(page, 'orders');
  await page.getByRole('button', { name: /^Order / }).first().click();
  await waitForPath(page, '/order-detail');
  await tapBack(page);
  await waitForPath(page, '/orders');
  await expectTab(page, 'orders');
});

// ─── Text-fit audit on the screens this PR exercises ─────────────────────────

test('text-fit audit: no truncated or overflowing text on the touched screens', async ({ browser }, testInfo) => {
  const page = await openSeller(browser);
  const report: Record<string, unknown[]> = {};
  expect(await countVisibleTextNodes(page)).toBeGreaterThan(10);
  report.dashboard = await collectTextOverflow(page);
  await page.getByRole('button', { name: 'Add a product' }).first().click();
  await waitForPath(page, '/add-product');
  expect(await countVisibleTextNodes(page)).toBeGreaterThan(10);
  report['add-product'] = await collectTextOverflow(page);
  await page.getByTestId('add-product-exit').click();
  await waitForPath(page, '/');
  await goToTab(page, 'products');
  report.products = await collectTextOverflow(page);
  await openStudio(page);
  report['studio-menu'] = await collectTextOverflow(page);
  await testInfo.attach('text-fit-report', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  for (const [screen, issues] of Object.entries(report)) {
    expect(issues, `${screen}: ${JSON.stringify(issues, null, 2)}`).toEqual([]);
  }
});
