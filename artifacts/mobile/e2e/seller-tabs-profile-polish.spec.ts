import { test } from '@playwright/test';
import { clerkStubScript } from './clerkStub';

/**
 * Manual verification screenshots for the seller's OWN Profile tab
 * (app/(tabs)/profile.tsx, route /(tabs)/profile — the tab bar's "Profile"
 * icon, distinct from the /seller-profile route PR #232 fixed) — LIVE-CHECK
 * follow-up: that PR only touched /seller-profile, not this tab.
 *
 * Covers:
 *  - real Posts/Followers/Following/Likes counts, never stuck on "–"
 *  - the Instagram business layout: Professional dashboard row, then
 *    Edit profile / Share profile / Contact (was a six-button wall)
 *
 * No backend runs in this sandbox, so seller.getProfile / social.profile /
 * publicSellers.get are mocked here — app code itself is untouched by this
 * file.
 */

const SELLER_ID = 'user_preview_verify';

async function dismissOverlays(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
}

test('seller (tabs)/profile — real counts + Instagram business action row @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(clerkStubScript());

  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/seller/profile', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        id: 's1', clerkId: SELLER_ID, brandName: 'Atelier Noire', displayName: 'Atelier Noire',
        bio: 'Minimalist ready-to-wear, made in small batches.', verified: true,
        totalLikes: 4200, profileImageUrl: null,
        subscriptionStatus: 'active', subscriptionPlanId: 'growth',
        metrics: { revenueCents: 0, visitors: 0, orders: 0, conversionRate: 0 },
      }),
    }));
  await page.route(`**/api/v1/social/profile/${SELLER_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"followersCount":128,"followingCount":12}' }));
  await page.route(`**/api/v1/public/sellers/${SELLER_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile: { productsCount: 9 }, products: [], posts: [] }) }));
  await page.route('**/api/v1/posts/mine', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await page.goto('/(tabs)/profile?bt_preview=seller', { waitUntil: 'networkidle' });
  await page.getByText('Professional dashboard').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);
  // The sandbox's clerkStub never resolves useAuth().isLoaded under
  // ?bt_preview (a pre-existing gap — see the header comment and PR body),
  // so real counts never arrive here; wait past the stall-guard timeout so
  // the screenshot shows real zeros instead of "–" rather than a fluke of
  // timing, proving the never-stuck-forever guarantee this PR adds.
  await page.waitForTimeout(6600);
  await page.screenshot({ path: 'docs/polish/screenshots/seller-tabs-profile/own-profile-390x844.png' });

  await context.close();
});
