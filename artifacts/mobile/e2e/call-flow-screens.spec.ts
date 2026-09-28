import { test, type Page } from '@playwright/test';

/**
 * Manual verification screenshots for the 1:1 call UI (PR1). Run against
 * the local Expo web dev server (see brandthread-agent.spec.ts's header
 * comment for the exact commands) via `?bt_preview=buyer`. The dev-web
 * preview bypass never signs in through Clerk (see buyer-conversation.tsx's
 * own comment on this), so no Clerk stub is needed here.
 */

const VIEWPORTS = [
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
] as const;

const OUT_DIR = 'docs/polish/screenshots/call-flow';

async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByLabel('Voice call').first().waitFor({ timeout: 20_000 });
  // Dismiss the cookie-consent banner if present so it doesn't sit in every screenshot.
  const acceptAll = page.getByRole('button', { name: /accept all/i }).first();
  if (await acceptAll.isVisible().catch(() => false)) await acceptAll.click().catch(() => {});
  await page.waitForTimeout(500);
}

for (const vp of VIEWPORTS) {
  test(`buyer call flow @ ${vp.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    // 1) Outgoing call
    await open(page, `/buyer-conversation?id=preview-conversation-01&bt_preview=buyer`);
    const videoBtn = page.getByLabel('Video call').first();
    await videoBtn.click({ timeout: 10_000 }).catch(async () => {
      await page.getByLabel('Voice call').first().click({ timeout: 10_000 });
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT_DIR}/1-outgoing-${vp.name}.png` });

    // 2) In-call, connected, camera-off state. previewCallProvider connects at
    // RING_MS (2200ms after start) then flips the peer's camera off at a
    // further PEER_CAMERA_TOGGLE_MS (4000ms) — wait past both from the click.
    await page.waitForTimeout(6600);
    await page.screenshot({ path: `${OUT_DIR}/2-incall-video-camera-off-${vp.name}.png` });

    // 3) End call -> ended + rating
    await page.getByLabel('End call').click({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT_DIR}/3-ended-rating-${vp.name}.png` });

    // 4) Tap a rating (auto-dismisses the ended screen shortly after) -> call
    // log bubble now visible in the thread.
    await page.getByLabel('Rate call quality: good').click({ timeout: 10_000 });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT_DIR}/4-call-log-bubble-${vp.name}.png` });

    await context.close();
  });

  test(`buyer incoming call + audio call @ ${vp.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    await open(page, `/buyer-conversation?id=preview-conversation-01&bt_preview=buyer`);
    await page.getByLabel('Voice call').first().click({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT_DIR}/5-outgoing-audio-${vp.name}.png` });
    await page.getByLabel('End call').click({ timeout: 10_000 }).catch(() => {});
    await context.close();
  });
}
