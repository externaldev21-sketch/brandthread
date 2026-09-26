import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * Regression check for the "Shop the Post" sheet close glitch (tap X → sheet
 * slides down, stalls ~1/4 of the way, then jumps the rest of the way) and
 * for the shared sheet motion (`useSheetTransition`,
 * components/ui/BottomSheet.tsx) that fixed it.
 *
 * Root cause (see PR description for the full write-up): ShopProductSheet's
 * close animation ran on the legacy `Animated` API with `useNativeDriver`,
 * which on react-native-web still executes via a JS-thread requestAnimationFrame
 * loop, not a real native/UI thread. That loop shares the main thread with
 * React's own re-renders (the feed behind the sheet, the sheet's own
 * ScrollView content, cart-success timers, etc.) — when the main thread stalls
 * for a frame, the JS-driven animation's *time-based* interpolation doesn't
 * pause, so the very next frame it renders jumps forward to catch up to
 * whatever position it "should" be at for elapsed real time. That produces
 * exactly the reported symptom: a pause, then a jump. The fix moves the
 * sheet's mount/close transform and swipe gesture onto Reanimated (a true
 * UI-thread animation), so it can't be stalled by main-thread JS work.
 *
 * This spec is NOT run in CI (same as e2e/brandthread-agent.spec.ts) — it
 * needs a live api-server + Postgres behind the mobile web build. How to run
 * it locally:
 *   1. Local Postgres 16, `pnpm --filter @workspace/db run push && migrate`.
 *   2. api-server: `pnpm --filter @workspace/api-server run dev`
 *      (DATABASE_URL + a syntactically-valid dummy CLERK_PUBLISHABLE_KEY).
 *   3. Mobile web, from artifacts/mobile:
 *      EXPO_PUBLIC_API_BASE_URL=http://<reachable-host>:5000 \
 *      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=<same dummy key> \
 *      pnpm exec expo start --web --port 8081
 *   4. From artifacts/mobile:
 *      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *      BASE_URL=http://127.0.0.1:8081 \
 *      pnpm exec playwright test e2e/sheet-close-motion.spec.ts -c e2e/playwright.config.ts
 *
 * A signed-in buyer session with at least one feed post carrying a shop tag,
 * and at least one saved item, are assumed to already exist in the seeded
 * dev database (this spec does not seed data itself — see
 * e2e/brandthread-agent.spec.ts's own header for the closest existing
 * example of standing up that data).
 */

test.use({
  launchOptions: {
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  },
});

/** How many samples the close-motion assertions look at, minimum. Below this
 *  the animation likely finished before the polling loop got moving, and the
 *  test would pass vacuously — treated as a hard failure instead. */
const MIN_SAMPLES = 4;
const MAX_CLOSE_MS = 300;

interface Sample {
  t: number;
  y: number;
}

/** Reads a translateY (in px) off an element's computed transform, or NaN if
 *  the element isn't found / has no transform yet. */
async function readTranslateY(locator: Locator): Promise<number> {
  return locator.evaluate(el => {
    const transform = getComputedStyle(el).transform;
    if (!transform || transform === 'none') return NaN;
    // matrix(a, b, c, d, tx, ty) for 2D transforms (translateY -> ty, index 5)
    const match = transform.match(/^matrix\(([^)]+)\)$/);
    if (!match) return NaN;
    const parts = match[1].split(',').map(s => parseFloat(s.trim()));
    return parts[5] ?? NaN;
  }).catch(() => NaN);
}

/**
 * Triggers a sheet's close (via `closeAction`) and samples its translateY at
 * high frequency until it settles, asserting:
 *   - at least `MIN_SAMPLES` distinct samples were taken (the polling loop
 *     actually caught the animation in flight, not just its end state)
 *   - the Y sequence is monotonically non-decreasing (closing = sliding
 *     further down / more positive translateY) — no pause-then-jump, no
 *     reversal
 *   - the whole close finishes within `MAX_CLOSE_MS`
 *
 * Reusable across any sheet built on the shared `useSheetTransition` /
 * `BottomSheet` primitive — pass the sheet's own root locator and whatever
 * closes it.
 */
async function assertSmoothSheetClose(
  page: Page,
  sheetLocator: Locator,
  closeAction: () => Promise<void>,
): Promise<{ samples: Sample[]; durationMs: number }> {
  const startY = await readTranslateY(sheetLocator);
  expect(Number.isNaN(startY) ? 0 : startY).toBeCloseTo(0, 0);

  const samples: Sample[] = [];
  const start = Date.now();
  let polling = true;

  const pollLoop = (async () => {
    while (polling) {
      const y = await readTranslateY(sheetLocator);
      if (!Number.isNaN(y)) samples.push({ t: Date.now() - start, y });
      // Poll roughly every animation frame — fast enough to catch a stall.
      await page.waitForTimeout(8);
    }
  })();

  await closeAction();
  // Wait for the sheet to actually leave the DOM/viewport (fully closed).
  await sheetLocator.waitFor({ state: 'hidden', timeout: MAX_CLOSE_MS + 2_000 }).catch(() => undefined);
  const durationMs = Date.now() - start;
  polling = false;
  await pollLoop;

  expect(samples.length, 'expected enough samples to observe the close in flight').toBeGreaterThanOrEqual(MIN_SAMPLES);

  for (let i = 1; i < samples.length; i++) {
    expect(
      samples[i].y,
      `sheet Y regressed or stalled between samples ${i - 1} (${JSON.stringify(samples[i - 1])}) and ${i} (${JSON.stringify(samples[i])}) — not monotonic`,
    ).toBeGreaterThanOrEqual(samples[i - 1].y);
  }

  // No two consecutive samples may hold the exact same Y for more than one
  // step in a row (a genuine stall/pause, not just fast sampling near 0/end).
  let repeat = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].y === samples[i - 1].y) {
      repeat++;
      expect(repeat, `sheet Y paused at ${samples[i].y}px for ${repeat + 1} consecutive samples`).toBeLessThan(3);
    } else {
      repeat = 0;
    }
  }

  expect(durationMs, `close animation took ${durationMs}ms, expected under ${MAX_CLOSE_MS}ms`).toBeLessThan(MAX_CLOSE_MS);

  return { samples, durationMs };
}

test.describe('Sheet close motion — no pause/jump, closes within budget', () => {
  test('Shop the Post sheet', async ({ page }) => {
    await page.goto('/(tabs)/feed', { waitUntil: 'networkidle' });

    // The shop-tag pill is collapsed by default; the first tap expands it,
    // the second (on the now-expanded pill) opens the Shop the Post sheet —
    // see ShopSideTab's onPress={expanded ? onPress : expand} in feed.tsx.
    const shopTag = page.getByTestId('shop-tag-pill').first();
    await expect(shopTag).toBeVisible({ timeout: 20_000 });
    await shopTag.click();
    await shopTag.click();

    const sheet = page.getByTestId('shop-product-sheet');
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    const closeBtn = sheet.getByLabel('Close', { exact: true });
    const { durationMs } = await assertSmoothSheetClose(page, sheet, () => closeBtn.click());
    console.log(`Shop the Post sheet close: ${durationMs}ms`);
  });

  test('Save to collection sheet', async ({ page }) => {
    await page.goto('/(buyer)/discover', { waitUntil: 'networkidle' });

    const saveBtn = page.getByLabel('Save', { exact: false }).first();
    await expect(saveBtn).toBeVisible({ timeout: 20_000 });
    await saveBtn.click({ delay: 600 }); // long-press to open "Save to…"

    const sheet = page.getByTestId('save-to-collection-sheet');
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    const closeBtn = sheet.getByLabel('Close', { exact: true });
    const { durationMs } = await assertSmoothSheetClose(page, sheet, () => closeBtn.click());
    console.log(`Save to collection sheet close: ${durationMs}ms`);
  });
});
