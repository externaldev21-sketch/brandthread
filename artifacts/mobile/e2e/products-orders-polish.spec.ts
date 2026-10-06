import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { collectTextOverflow, countVisibleTextNodes } from './textFit';

/**
 * Products + Orders tab polish @ 393×852 (seller web preview):
 *  - status chip row is a swipeable rail: touch swipe and mouse drag both
 *    change scrollLeft, no scrollbar, 16px gutter at both ends, only the
 *    rail moves (search bar + its two buttons stay put), tap scrolls a chip
 *    into view, count badges hidden at 0;
 *  - Products empty state matches the selected filter;
 *  - Products sort button is arrow-up-down and opens the five-option sheet;
 *  - Orders empty state matches each filter / search;
 *  - text-fit audit on every state.
 *
 *   CI=1 EXPO_OFFLINE=1 pnpm exec expo start --web --port 8081
 *   BASE_URL=http://127.0.0.1:8081 pnpm exec playwright test -c e2e/playwright.config.ts e2e/products-orders-polish.spec.ts
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8081';
const DIR = 'docs/polish/screenshots/products-orders-polish';
const VIEWPORT = { width: 393, height: 852 };

async function openSeller(browser: Browser, path: string, opts: BrowserContextOptions = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ...opts });
  const page = await context.newPage();
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(`${BASE}${path}?bt_preview=seller&demo=1`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  await page.getByTestId('seller-list-chip-rail').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 2000 }).catch(() => {});
  // Expo web's dev-only LogBox toast (pre-existing nested-<button> warning)
  // sits over the bottom of the screen; its "×" is the only way to close it.
  for (let i = 0; i < 3; i++) {
    if (!(await page.getByText('cannot contain a ne', { exact: false }).first().isVisible().catch(() => false))) break;
    await page.mouse.click(309, 817);
    await page.waitForTimeout(250);
  }
  return page;
}

const rail = (page: Page) => page.getByTestId('seller-list-chip-rail');

async function railMetrics(page: Page) {
  return rail(page).evaluate((node) => {
    const el = node as HTMLElement;
    const r = el.getBoundingClientRect();
    const chips = Array.from(el.querySelectorAll<HTMLElement>('[data-chip-active]'));
    return {
      scrollLeft: el.scrollLeft,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollbarPx: el.offsetHeight - el.clientHeight,
      left: r.left,
      right: r.right,
      chips: chips.map((c) => {
        const cr = c.getBoundingClientRect();
        const btn = c.querySelector('[role="button"]');
        return { label: btn?.getAttribute('aria-label') ?? '', selected: c.getAttribute('data-chip-active') === 'true', left: cr.left, right: cr.right, height: cr.height };
      }),
    };
  });
}

async function selectedChip(page: Page) {
  return (await railMetrics(page)).chips.find((c) => c.selected)?.label ?? null;
}

/** Finger swipe across the rail: real touchstart/move/end through CDP. */
async function touchSwipe(page: Page, xDistance: number) {
  const box = (await rail(page).boundingBox())!;
  const y = Math.round(box.y + box.height / 2);
  const startX = Math.round(xDistance < 0 ? box.x + box.width * 0.8 : box.x + box.width * 0.2);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + Math.round((xDistance * i) / steps), y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
}

async function mouseDrag(page: Page, fromX: number, toX: number) {
  const box = (await rail(page).boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(fromX + ((toX - fromX) * i) / 12, y);
  await page.mouse.up();
  await page.waitForTimeout(900); // momentum glide + snap settle
}

async function searchRowBox(page: Page, placeholder: string) {
  return (await page.getByPlaceholder(placeholder).boundingBox())!;
}

async function expectNoTextOverflow(page: Page, label: string) {
  expect(await countVisibleTextNodes(page), `${label}: nothing rendered`).toBeGreaterThan(5);
  const issues = await collectTextOverflow(page);
  expect(issues, `${label}: ${JSON.stringify(issues, null, 2)}`).toEqual([]);
}

async function zoom(page: Page, name: string) {
  await rail(page).screenshot({ path: `${DIR}/zoom-${name}-chips.png` });
  const empty = page.getByTestId(/^(products|orders)-empty$/).first();
  if (await empty.isVisible().catch(() => false)) await empty.screenshot({ path: `${DIR}/zoom-${name}-empty.png` });
}

for (const tab of [
  { name: 'products', path: '/products', search: 'Search products…' },
  { name: 'orders', path: '/orders', search: 'Search orders' },
] as const) {
  test.describe(`${tab.name} chip rail`, () => {
    test('touch swipe scrolls only the chip row, with no visible scrollbar', async ({ browser }) => {
      const page = await openSeller(browser, tab.path);
      const before = await railMetrics(page);
      expect(before.scrollWidth, 'chips overflow the screen, so the row must scroll').toBeGreaterThan(before.clientWidth);
      expect(before.scrollbarPx).toBe(0);
      expect(await rail(page).evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe('none');
      const searchBefore = await searchRowBox(page, tab.search);

      await touchSwipe(page, -220);
      const after = await railMetrics(page);
      expect(after.scrollLeft).toBeGreaterThan(before.scrollLeft + 20);
      expect(await searchRowBox(page, tab.search)).toEqual(searchBefore);
      await page.screenshot({ path: `${DIR}/${tab.name}-rail-swiped.png` });

      await touchSwipe(page, 400);
      expect((await railMetrics(page)).scrollLeft).toBeLessThan(after.scrollLeft);
    });

    test('mouse drag scrolls the row and never selects the chip under the pointer', async ({ browser }) => {
      const page = await openSeller(browser, tab.path, { isMobile: false, hasTouch: false });
      const before = await railMetrics(page);
      const selectedBefore = await selectedChip(page);
      await mouseDrag(page, 330, 90);
      const after = await railMetrics(page);
      expect(after.scrollLeft).toBeGreaterThan(before.scrollLeft + 40);
      expect(await selectedChip(page)).toBe(selectedBefore);
      expect(after.scrollbarPx).toBe(0);
    });

    test('16px gutter at both ends, equal chip heights, no zero badges', async ({ browser }) => {
      const page = await openSeller(browser, tab.path);
      const start = await railMetrics(page);
      expect(Math.round(start.chips[0].left - start.left)).toBe(16);
      const heights = new Set(start.chips.map((c) => Math.round(c.height)));
      expect(heights.size, `chip heights ${[...heights]}`).toBe(1);
      for (const c of start.chips) expect(c.label, 'count badge shown for 0').not.toMatch(/, 0$/);

      await rail(page).evaluate((el) => { (el as HTMLElement).style.scrollSnapType = 'none'; el.scrollLeft = el.scrollWidth; });
      await page.waitForTimeout(200);
      const end = await railMetrics(page);
      const last = end.chips[end.chips.length - 1];
      expect(Math.round(end.right - last.right)).toBe(16);
    });

    test('tapping a chip selects it and scrolls it fully into view', async ({ browser }) => {
      const page = await openSeller(browser, tab.path);
      const { chips } = await railMetrics(page);
      const lastLabel = chips[chips.length - 1].label;
      await page.getByRole('button', { name: lastLabel, exact: true }).click();
      await page.waitForTimeout(700);
      const after = await railMetrics(page);
      const last = after.chips.find((c) => c.label.startsWith(lastLabel.split(',')[0]))!;
      expect(last.selected).toBe(true);
      expect(last.left).toBeGreaterThanOrEqual(after.left);
      expect(last.right).toBeLessThanOrEqual(after.right);
    });
  });
}

test('products: every filter state shows its own empty state', async ({ browser }) => {
  const page = await openSeller(browser, '/products');
  const states = [
    { chip: 'All', title: 'No products yet', action: true },
    { chip: 'Active', title: 'No active products', action: true },
    { chip: 'Draft', title: 'No drafts', action: false },
    { chip: 'Archived', title: 'No archived products', action: false },
    { chip: 'Low Stock', title: 'Nothing low on stock', action: false },
    { chip: 'Out of Stock', title: 'Nothing out of stock', action: false },
  ];
  for (const s of states) {
    await page.getByRole('button', { name: s.chip, exact: true }).click();
    await page.waitForTimeout(600);
    const empty = page.getByTestId('products-empty');
    await expect(empty.getByText(s.title, { exact: true })).toBeVisible();
    await expect(empty.getByRole('button', { name: 'Add product' })).toHaveCount(s.action ? 1 : 0);
    const slug = s.chip.toLowerCase().replace(/\s+/g, '-');
    await page.screenshot({ path: `${DIR}/products-${slug}.png` });
    await zoom(page, `products-${slug}`);
    await expectNoTextOverflow(page, `products/${s.chip}`);
  }
});

test('products: search with no hits says "No matching products"', async ({ browser }) => {
  const page = await openSeller(browser, '/products');
  await page.getByPlaceholder('Search products…').fill('zzzz');
  await page.waitForTimeout(800);
  await expect(page.getByTestId('products-empty').getByText('No matching products', { exact: true })).toBeVisible();
  await expect(page.getByTestId('products-empty').getByRole('button', { name: 'Add product' })).toHaveCount(0);
  await page.screenshot({ path: `${DIR}/products-search-empty.png` });
});

test('products: empty-state "Add product" opens add-product and Cancel returns to Products', async ({ browser }) => {
  const page = await openSeller(browser, '/products');
  const add = page.getByTestId('products-empty').getByRole('button', { name: 'Add product' });
  const box = (await add.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(36);
  await add.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/add-product');
  expect(new URL(page.url()).searchParams.get('from')).toBe('products');
  await page.getByTestId('add-product-exit').click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/products');
  await expect(page.getByTestId('seller-tab-products')).toHaveAttribute('aria-selected', 'true');
});

test('products: sort button opens the five-option sheet and applies the choice', async ({ browser }) => {
  const page = await openSeller(browser, '/products');
  const sortBtn = page.getByRole('button', { name: 'Sort: Newest' });
  await expect(sortBtn).toBeVisible();
  // Filter (sliders) and sort buttons: same size, side by side.
  const filterBox = (await page.getByRole('button', { name: 'Filter products' }).boundingBox())!;
  const sortBox = (await sortBtn.boundingBox())!;
  expect(Math.round(sortBox.width)).toBe(Math.round(filterBox.width));
  expect(Math.round(sortBox.height)).toBe(Math.round(filterBox.height));
  await page.locator('div').filter({ has: page.getByPlaceholder('Search products…') }).last()
    .screenshot({ path: `${DIR}/zoom-products-search-row.png` }).catch(() => {});
  await sortBtn.screenshot({ path: `${DIR}/zoom-products-sort-button.png` });

  await sortBtn.click();
  await page.waitForTimeout(500);
  for (const label of ['Newest', 'Oldest', 'Price: high to low', 'Price: low to high', 'Best selling']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Name A-Z' })).toHaveCount(0);
  await page.screenshot({ path: `${DIR}/products-sort-sheet.png` });
  await expectNoTextOverflow(page, 'products/sort sheet');

  await page.getByRole('button', { name: 'Price: high to low', exact: true }).click();
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: 'Sort: Price: high to low' })).toBeVisible();
});

test('orders: every chip state renders, and empty filters say exactly what is empty', async ({ browser }) => {
  const page = await openSeller(browser, '/orders');
  const { chips } = await railMetrics(page);
  for (const chip of chips) {
    const name = chip.label.split(',')[0];
    await page.getByRole('button', { name: chip.label, exact: true }).click();
    await page.waitForTimeout(600);
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    await page.screenshot({ path: `${DIR}/orders-${slug}.png` });
    await zoom(page, `orders-${slug}`);
    await expectNoTextOverflow(page, `orders/${name}`);
    const empty = page.getByTestId('orders-empty');
    if (await empty.isVisible().catch(() => false)) {
      await expect(empty.getByText(name === 'All' ? 'No orders yet' : `No ${name.toLowerCase()} orders`, { exact: true })).toBeVisible();
    }
  }

  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByPlaceholder('Search orders').fill('zzzz');
  await page.waitForTimeout(600);
  await expect(page.getByTestId('orders-empty').getByText('No matching orders', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${DIR}/orders-search-empty.png` });

  await page.getByPlaceholder('Search orders').fill('');
  await page.getByRole('button', { name: 'Filter orders' }).click();
  await page.getByRole('button', { name: 'Filter orders by Disputed' }).click();
  await page.waitForTimeout(600);
  await expect(page.getByTestId('orders-empty').getByText('No disputed orders', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${DIR}/orders-disputed-empty.png` });
  await zoom(page, 'orders-disputed');
});
