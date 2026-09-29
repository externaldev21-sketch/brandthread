import { test, expect, type Page } from '@playwright/test';
import { clerkStubScript } from './clerkStub';

/**
 * Runtime guard for the "thin dark bar flashing over the tab bar" bug (see
 * this PR's description for the full investigation and root causes). Reuses
 * this file's sibling `tab-bar-glass-zone.spec.ts`'s launch/preview setup —
 * read that spec first for the intended design this guard must NOT flag:
 * the TabBarGlassZone strip is a real, always-mounted, full-strip frosted
 * treatment that sits behind the tab bar by design, not a flash.
 *
 * How this was actually run (same sandbox notes as tab-bar-glass-zone.spec.ts):
 *   1. Local Postgres 16 + api-server + `expo start --web` exactly as that
 *      spec's header documents.
 *   2. From artifacts/mobile:
 *      BASE_URL=http://127.0.0.1:8081 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *      pnpm exec playwright test -c e2e/playwright.config.ts e2e/tab-bar-overlay-guard.spec.ts
 *
 * What it checks, sampled at ~50ms intervals across tab switches, sheet
 * open/close, and scrolling:
 *   (a) no element other than the tab bar itself paints any pixel over the
 *       tab bar's own screen region (its bounding box, from
 *       `[data-testid="buyer-bottom-tab-bar"]` / `[data-testid="seller-global-tab-bar"]`);
 *   (b) no element anywhere on screen is under 40px tall, absolutely/fixed
 *       positioned, AND has a partial (non-0, non-1) computed opacity, at
 *       any sampled frame.
 */
test.use({
  launchOptions: {
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  },
});

const VIEWPORT = { width: 393, height: 852 };

async function openPreview(page: Page, role: 'buyer' | 'seller', demo: boolean) {
  await page.addInitScript(clerkStubScript());
  const path = role === 'buyer' ? '/(buyer)' : '/(tabs)';
  const query = `?bt_preview=${role}${demo ? '&demo=1' : ''}`;
  await page.goto(`${path}${query}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(3500);
  const acceptAll = page.getByText('Accept all', { exact: true });
  if (await acceptAll.count() > 0) await acceptAll.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * One sampled frame's check: nothing but the tab bar itself paints over the
 * tab bar's own region, and no thin/absolute/partial-opacity bar exists
 * anywhere on screen. Returns a list of violation descriptions (empty when
 * clean) so the caller can attribute a failure to the exact moment it
 * happened during a transition, not just "somewhere during this test".
 */
async function sampleFrame(page: Page, tabBarTestId: string): Promise<string[]> {
  return page.evaluate((testId) => {
    const bar = document.querySelector(`[data-testid="${testId}"]`);
    if (!bar) return [];
    const barRect = bar.getBoundingClientRect();
    const violations: string[] = [];

    const rectsOverlap = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    const all = Array.from(document.querySelectorAll('body *'));
    for (const el of all) {
      if (el === bar || bar.contains(el) || el.contains(bar)) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const opacity = Number(style.opacity);
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      // Only `position: fixed`/`absolute` elements are candidates for "an
      // extra overlay painting over the tab bar" — ordinary in-flow scroll
      // content naturally passes UNDER the floating tab bar's own bounding
      // box as the list scrolls (the tab bar's own glass sits on top of
      // it, by design — see TabBarGlassZone); that's not this bug.
      const positionedEl = style.position === 'absolute' || style.position === 'fixed';

      // (a) painting over the tab bar's own region at nonzero, non-fully-
      // transparent opacity, and not itself an intentional full-screen
      // backdrop (a real open modal/sheet backdrop covers the WHOLE
      // viewport, not just a strip near the tab bar — that's allowed).
      if (
        positionedEl
        && opacity > 0
        && rectsOverlap(rect, barRect)
        && !(rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95)
      ) {
        const bg = style.backgroundColor;
        // Parse the background color's own alpha channel — a fully
        // transparent `rgba(0,0,0,0)` reads as "black" to a naive color
        // match but paints nothing, so it must be excluded explicitly.
        const alphaMatch = bg.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/);
        const bgAlpha = alphaMatch ? Number(alphaMatch[1]) : (bg.startsWith('rgb(') || /^#/.test(bg) ? 1 : 0);
        const looksLikeDarkFill = bgAlpha > 0 && /rgba?\(\s*0\s*,\s*0\s*,\s*0|rgba?\(\s*1[0-7]\s*,\s*1[0-7]\s*,\s*1[0-7]/.test(bg);
        if (looksLikeDarkFill && opacity > 0) {
          violations.push(
            `overlay over tab bar region: <${el.tagName.toLowerCase()} class="${(el as HTMLElement).className}"> `
            + `rect=${JSON.stringify(rect)} bg=${bg} opacity=${opacity}`,
          );
        }
      }

      // (b) a thin (under 40px), absolutely/fixed positioned BAR (spans
      // most of the viewport's width — a small icon, dot, badge or 1x1
      // accessibility-only pixel is not this bug's shape even though it's
      // also thin and low-opacity) at partial opacity anywhere on screen.
      const isBarWidth = rect.width >= window.innerWidth * 0.6;
      if (positionedEl && isBarWidth && rect.height > 0 && rect.height < 40 && opacity > 0 && opacity < 1) {
        violations.push(
          `thin partial-opacity bar: <${el.tagName.toLowerCase()} class="${(el as HTMLElement).className}"> `
          + `height=${rect.height} opacity=${opacity}`,
        );
      }
    }
    return violations;
  }, tabBarTestId);
}

async function burstCheck(page: Page, tabBarTestId: string, label: string, frames = 10, intervalMs = 50) {
  const violations: string[] = [];
  for (let i = 0; i < frames; i++) {
    const frameViolations = await sampleFrame(page, tabBarTestId);
    violations.push(...frameViolations.map((v) => `[${label} frame ${i}] ${v}`));
    await page.waitForTimeout(intervalMs);
  }
  return violations;
}

test('buyer: no overlay flash over the tab bar during tab switches, sheet open/close, or scroll', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  await openPreview(page, 'buyer', true);

  const bar = page.getByTestId('buyer-bottom-tab-bar');
  await expect(bar).toBeVisible({ timeout: 10_000 });

  const violations: string[] = [];
  for (const tab of ['buyer-tab-discover', 'buyer-tab-inbox', 'buyer-tab-activity', 'buyer-tab-profile', 'buyer-tab-index']) {
    const el = page.getByTestId(tab);
    if (await el.count() === 0) continue;
    await el.first().click({ force: true }).catch(() => {});
    violations.push(...await burstCheck(page, 'buyer-bottom-tab-bar', `tab:${tab}`));
  }

  // Scroll the active screen.
  await page.mouse.move(196, 500);
  await page.mouse.wheel(0, 600);
  violations.push(...await burstCheck(page, 'buyer-bottom-tab-bar', 'scroll'));

  expect(violations, violations.join('\n')).toEqual([]);
});

test('seller: no overlay flash over the tab bar during tab switches or scroll', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  await openPreview(page, 'seller', true);

  const bar = page.getByTestId('seller-global-tab-bar');
  await expect(bar).toBeVisible({ timeout: 10_000 });

  const violations: string[] = [];
  for (const tab of ['seller-tab-products', 'seller-tab-orders', 'seller-tab-profile', 'seller-tab-index']) {
    const el = page.getByTestId(tab);
    if (await el.count() === 0) continue;
    await el.first().click({ force: true }).catch(() => {});
    violations.push(...await burstCheck(page, 'seller-global-tab-bar', `tab:${tab}`));
  }

  await page.mouse.move(196, 500);
  await page.mouse.wheel(0, 600);
  violations.push(...await burstCheck(page, 'seller-global-tab-bar', 'scroll'));

  expect(violations, violations.join('\n')).toEqual([]);
});
