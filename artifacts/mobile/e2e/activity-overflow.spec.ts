import { test, expect, type Page } from '@playwright/test';
import { clerkStubScript } from './clerkStub';

/**
 * Manual/local verification that the redesigned Activity screen never lets
 * any element bleed past the viewport edge, at three representative phone
 * widths (iPhone SE, a mid-size phone, iPhone 14/15 Pro Max). Run the same
 * way as brandthread-agent.spec.ts (api-server + Expo web already running,
 * see that file's header comment for the exact commands) via
 * `?bt_preview=buyer`, so the screen renders the seeded preview feed (every
 * row type: follows, follow-backs, grouped likes, story/highlight likes,
 * comments, mentions, reposts, Thread Cash, orders, suggested people)
 * without a live backend.
 */

const VIEWPORTS = [
  { name: '375x667', width: 375, height: 667 },   // iPhone SE
  { name: '390x844', width: 390, height: 844 },   // iPhone 13/14
  { name: '430x932', width: 430, height: 932 },   // iPhone 15 Pro Max
] as const;

/** Every element on the page whose box extends past the viewport's left/right edges. */
async function findHorizontalOverflow(page: Page, viewportWidth: number) {
  return page.evaluate((vw) => {
    const offenders: Array<{ tag: string; cls: string; left: number; right: number; text: string }> = [];
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > vw + 1 || rect.left < -1) {
        offenders.push({
          tag: el.tagName,
          cls: (el.className || '').toString().slice(0, 60),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          text: (el.textContent || '').slice(0, 60),
        });
      }
    }
    return offenders;
  }, viewportWidth);
}

for (const viewport of VIEWPORTS) {
  test(`Activity has no horizontal overflow at ${viewport.name}`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })).newPage();
    await page.addInitScript(clerkStubScript());
    await page.goto('/activity-center?bt_preview=buyer', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await expect(page.getByRole('button', { name: /New followers/ })).toBeVisible({ timeout: 20_000 });

    const acceptCookies = page.getByRole('button', { name: 'Accept all' });
    if (await acceptCookies.isVisible().catch(() => false)) await acceptCookies.click();
    await page.waitForTimeout(1500);

    // Scroll through the full list (New/Today/This week/This month/Earlier
    // sections plus Suggested for you) checking overflow at each depth —
    // a bug that only appears once "Suggested for you" mounts wouldn't show
    // at the top of the list. RN-Web's SectionList only responds to wheel
    // events, not window.scrollBy.
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    for (let step = 0; step < 6; step++) {
      const offenders = await findHorizontalOverflow(page, viewport.width);
      expect(offenders, `Elements overflowing the ${viewport.width}px viewport at scroll step ${step}:\n${JSON.stringify(offenders, null, 2)}`).toEqual([]);
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(500);
    }

    await page.close();
  });
}
