import { test, expect, type Page } from '@playwright/test';
import { clerkStubScript } from './clerkStub';

/**
 * Manual/local verification that the buyer Threads Home top row (Friends/
 * Drops/Live, the centered Following|Threads switcher, Search/Cart) never
 * overlaps itself at three representative phone widths. Run the same way as
 * brandthread-agent.spec.ts (api-server + Expo web already running, see
 * that file's header comment for the exact commands) via `?bt_preview=buyer`.
 *
 * This sandbox can't reach cdp.expo.dev to launch a browser, so this file
 * is written but not run here — see the PR description for the by-hand
 * math this was designed against instead.
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

    const live = await page.getByTestId('buyer-home-live').boundingBox();
    const search = await page.getByTestId('buyer-home-search-icon').boundingBox();
    const tabs = await page.getByTestId('buyer-home-tabs').boundingBox();
    expect(live).toBeTruthy();
    expect(search).toBeTruthy();
    expect(tabs).toBeTruthy();
    if (!live || !search || !tabs) return;

    const leftClusterRight = live.x + live.width;
    const rightClusterLeft = search.x;
    const tabsLeft = tabs.x;
    const tabsRight = tabs.x + tabs.width;
    const tabsCenter = tabs.x + tabs.width / 2;

    // Bell is gone — only search + cart on the right, so the first icon in
    // the right cluster (search) is the one that can get closest to the tabs.
    expect(tabsLeft - leftClusterRight).toBeGreaterThanOrEqual(MIN_CLEARANCE);
    expect(rightClusterLeft - tabsRight).toBeGreaterThanOrEqual(MIN_CLEARANCE);
    // Centered on the screen (not the leftover flex space between two
    // differently-sized clusters), within a couple pixels for font metrics.
    expect(Math.abs(tabsCenter - viewport.width / 2)).toBeLessThanOrEqual(3);
  });
}
