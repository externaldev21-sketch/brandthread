import { test, expect, type Page } from '@playwright/test';
import { clerkStubScript } from './clerkStub';

/**
 * Manual/local verification that Messages rows never let a LIVE avatar's
 * ring bleed past the row's left gutter, and that every row (live or not,
 * with or without order context) shares the same ~72pt height. Run the
 * same way as brandthread-agent.spec.ts (api-server + Expo web already
 * running, see that file's header comment for the exact commands) via
 * `?bt_preview=buyer`.
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

const GUTTER = 16;
const ROW_HEIGHT = 72;
const ROW_TOLERANCE = 2;

for (const viewport of VIEWPORTS) {
  test(`Messages avatars and row heights are consistent at ${viewport.name}`, async ({ browser }) => {
    const page: Page = await (await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })).newPage();
    await page.addInitScript(clerkStubScript());
    await page.goto('/(buyer)/inbox?bt_preview=buyer', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });

    const rows = await page.locator('[data-testid^="inbox-conversation-"]').all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const box = await row.boundingBox();
      expect(box).toBeTruthy();
      if (!box) continue;
      expect(box.height).toBeGreaterThanOrEqual(ROW_HEIGHT - ROW_TOLERANCE);
      expect(box.height).toBeLessThanOrEqual(ROW_HEIGHT + ROW_TOLERANCE);

      // Every visible descendant of the row (photo, ring, LIVE tag) must
      // stay at or right of the shared 16pt gutter.
      const offenders = await row.evaluate((el, gutter) => {
        const bad: Array<{ tag: string; left: number }> = [];
        for (const node of el.querySelectorAll('*')) {
          const rect = node.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (rect.left < gutter - 1) {
            bad.push({ tag: node.tagName, left: Math.round(rect.left) });
          }
        }
        return bad;
      }, GUTTER);
      expect(offenders).toEqual([]);
    }
  });
}
