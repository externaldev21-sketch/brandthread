import { test, expect } from '@playwright/test';
import { pageAs, apiAs, BUYER, SELLER } from './socialHarness';

/**
 * Post engagement, both sides, real API + Postgres (see socialHarness.ts).
 * The buyer engages in the UI; the seller's side is asserted through the
 * seller's own API reads (analytics, Activity) and the seller's screen.
 */
const shots = process.env.SOCIAL_E2E_SHOTS ?? '../../docs/pr-assets/social-e2e';

// Engagement-bar buttons, found by their icon glyph (Feather / FontAwesome
// codepoints) so the spec doesn't depend on label wording.
const GLYPH = { heart: 61825, repeat: 61897, bookmark: 61732, bookmarkFilled: 61486 } as const;
const icon = (page: import('@playwright/test').Page, glyph: number) =>
  page.getByText(String.fromCodePoint(glyph), { exact: true }).last();
/** The tappable control around an icon (a click on the glyph reaches it). */
const iconButton = (page: import('@playwright/test').Page, glyph: number) => icon(page, glyph).locator('xpath=..');

test('buyer likes, saves and reposts a seller post; seller sees it; state survives reload', async ({ browser }) => {
  test.setTimeout(240_000);
  const feed = await apiAs<any[]>(BUYER, 'GET', '/api/posts/feed');
  const post = feed.body.find((p) => p.caption === 'Studio day')!;
  // Clean slate for this post.
  await apiAs(BUYER, 'POST', `/api/posts/${post.id}/interact`, { type: 'like', value: 'remove' });
  await apiAs(BUYER, 'POST', `/api/posts/${post.id}/interact`, { type: 'repost', value: 'remove' });
  await apiAs(BUYER, 'DELETE', `/api/buyer/saved/${post.id}`);

  const buyer = await pageAs(browser, BUYER);
  // A seller post opened from a share link / Saved — used to be a placeholder.
  await buyer.goto(`/buyer-post-viewer?postId=${post.id}`, { waitUntil: 'load' });
  await expect(buyer.getByText('Studio day')).toBeVisible({ timeout: 60_000 });
  await buyer.screenshot({ path: `${shots}/engagement-1-viewer-before.png` });

  await iconButton(buyer, GLYPH.heart).click();
  await iconButton(buyer, GLYPH.repeat).click();
  await iconButton(buyer, GLYPH.bookmark).click();
  await expect(iconButton(buyer, GLYPH.heart)).toContainText('1');
  await expect(iconButton(buyer, GLYPH.bookmarkFilled)).toBeVisible();

  // Seller side: analytics + Activity reflect the buyer's real actions.
  await expect.poll(async () => (await apiAs(SELLER, 'GET', `/api/posts/${post.id}/analytics`)).body.metrics.likes).toBe(1);
  const analytics = (await apiAs(SELLER, 'GET', `/api/posts/${post.id}/analytics`)).body.metrics;
  expect(analytics.reposts).toBe(1);
  expect(analytics.saves.count).toBe(1);
  expect(analytics.views.count).toBeGreaterThanOrEqual(1); // the viewer now records the open
  await expect.poll(async () => {
    const feedRows = (await apiAs<any>(SELLER, 'GET', '/api/buyer/notifications?limit=50')).body;
    const rows = Array.isArray(feedRows) ? feedRows : feedRows.items ?? feedRows.notifications ?? [];
    return rows.some((n: any) => n.type === 'post_like' && n.targetId === post.id);
  }).toBe(true);

  // Reload: the buyer's own state comes back from the server.
  await buyer.reload({ waitUntil: 'load' });
  await expect(iconButton(buyer, GLYPH.heart)).toContainText('1', { timeout: 60_000 });
  await expect(iconButton(buyer, GLYPH.bookmarkFilled)).toBeVisible();
  const state = (await apiAs(BUYER, 'GET', `/api/posts/${post.id}`)).body;
  expect(state).toMatchObject({ likedByMe: true, savedByMe: true, repostedByMe: true });
  await buyer.screenshot({ path: `${shots}/engagement-2-viewer-after-reload.png` });

  // Unlike after reload really unlikes on the seller's side.
  await iconButton(buyer, GLYPH.heart).click();
  await expect.poll(async () => (await apiAs(SELLER, 'GET', `/api/posts/${post.id}/analytics`)).body.metrics.likes).toBe(0);

  // The seller's own post analytics screen shows the real numbers.
  const seller = await pageAs(browser, SELLER);
  await seller.goto(`/post-analytics?id=${post.id}`, { waitUntil: 'load' });
  await seller.waitForTimeout(6000);
  await seller.screenshot({ path: `${shots}/engagement-3-seller-post-analytics.png` });
});
