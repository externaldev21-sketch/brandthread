import { test, expect, type Page } from '@playwright/test';
import { clerkStubScript } from './clerkStub';

/**
 * Manual/local verification that the buyer Threads Home top row (Cart, the
 * centered LIVE · Following · Threads tabs, Search) never overlaps itself
 * at three representative phone widths, and that Cart/Search mirror each
 * other around the screen-centered tabs (TikTok's header). Run the same way
 * as brandthread-agent.spec.ts (Expo web already running) via
 * `?bt_preview=buyer`.
 */

const VIEWPORTS = [
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
] as const;

const MIN_CLEARANCE = 12;

for (const viewport of VIEWPORTS) {
  test(`Feed top row has no overlap at ${viewport.name}`, async ({ browser }) => {
    const page: Page = await (await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })).newPage();
    await page.addInitScript(clerkStubScript());
    await page.goto('/(tabs)?bt_preview=buyer', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });

    const cart = await page.getByTestId('buyer-home-cart-icon').boundingBox();
    const search = await page.getByTestId('buyer-home-search-icon').boundingBox();
    const tabs = await page.getByTestId('buyer-home-tabs').boundingBox();
    const live = await page.getByTestId('buyer-home-tabs-live').boundingBox();
    const threads = await page.getByTestId('buyer-home-tabs-for-you').boundingBox();
    // The old TV glyph / LIVE edge tab are gone.
    await expect(page.getByTestId('buyer-home-live')).toHaveCount(0);
    expect(cart && search && tabs && live && threads).toBeTruthy();
    if (!cart || !search || !tabs || !live || !threads) return;

    // Tab labels clear both icons.
    expect(live.x - (cart.x + cart.width)).toBeGreaterThanOrEqual(MIN_CLEARANCE);
    expect(search.x - (threads.x + threads.width)).toBeGreaterThanOrEqual(MIN_CLEARANCE);
    // Cart and Search mirror each other and sit level with the tabs.
    expect(Math.abs((cart.x + cart.width / 2) + (search.x + search.width / 2) - viewport.width)).toBeLessThanOrEqual(2);
    expect(Math.abs((cart.y + cart.height / 2) - (search.y + search.height / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs((cart.y + cart.height / 2) - (tabs.y + tabs.height / 2))).toBeLessThanOrEqual(3);
    // Centered on the screen, within a couple pixels for font metrics.
    expect(Math.abs(tabs.x + tabs.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(3);
  });
}
