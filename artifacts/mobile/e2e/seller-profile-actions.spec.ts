import { test } from '@playwright/test';
import { clerkStubScript } from './clerkStub';

/**
 * Manual verification screenshots for the seller-profile owner action row
 * (Professional dashboard row + Edit profile / Share profile, matching
 * mobbin.com/screens/7b7b7c39-39a7-4ba6-bf3a-45c009a4769d) and the real
 * follower/following/videos/rating counts fix (previously stuck on "–").
 * No backend is running in this sandbox, so the network calls this screen
 * makes are mocked here — app code itself is untouched by this file.
 *
 * Two separate captures, not one combined shot: `?isOwner=true` reaches the
 * exact owner-action-row JSX this PR changed, but that param path also
 * gates on Clerk's `useAuth().isLoaded`/`userId`, which this repo's
 * `clerkStub.ts` (built for screens with no such gate) doesn't resolve —
 * a pre-existing preview-tooling gap, not something this PR introduces or
 * fixes. The `?id=<clerkId>` route sidesteps that gate and proves the
 * counts fix with real numbers, but lands on the *visitor* action row
 * (Follow/Message) since `isOwner` there depends on the same unresolved
 * `userId`. Both screenshots exercise the real, unmodified component tree;
 * only the network layer is mocked.
 */

const SELLER_ID = 'user_preview_verify';
const PROFILE_JSON = {
  clerkId: SELLER_ID, brandName: 'Atelier Noire', displayName: 'Atelier Noire',
  username: 'atelier_noire', bio: 'Minimalist ready-to-wear, made in small batches.',
  verified: true, followersCount: 128, followingCount: 12, videosCount: 6, productsCount: 9,
};

async function dismissOverlays(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
}

test('seller profile — owner action row (Professional dashboard + Edit/Share) @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(clerkStubScript());

  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/v1/seller/profile', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...PROFILE_JSON, id: 's1', totalLikes: 4200, metrics: { revenueCents: 0, visitors: 0, orders: 0, conversionRate: 0 } }),
    }));
  await page.route(`**/api/v1/public/sellers/${SELLER_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile: PROFILE_JSON, products: [], posts: [] }) }));

  await page.goto('/seller-profile?isOwner=true&bt_preview=seller', { waitUntil: 'networkidle' });
  await page.getByText('Add cover video').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);
  await page.screenshot({ path: 'docs/polish/screenshots/seller-profile-actions/owner-actions-390x844.png' });

  await context.close();
});

test('seller profile — real counts, not "–" @ 390x844', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(clerkStubScript());

  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route(`**/api/v1/public/sellers/${SELLER_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile: PROFILE_JSON, products: [], posts: [] }) }));
  await page.route(`**/api/v1/social/profile/${SELLER_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"followersCount":128,"followingCount":12}' }));
  await page.route(`**/api/v1/reviews/seller/${SELLER_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"avgRating":4.8,"totalCount":34}' }));

  await page.goto(`/seller-profile?id=${SELLER_ID}&bt_preview=seller`, { waitUntil: 'networkidle' });
  await page.getByText('Atelier Noire').first().waitFor({ timeout: 20_000 });
  await dismissOverlays(page);
  await page.screenshot({ path: 'docs/polish/screenshots/seller-profile-actions/real-counts-390x844.png' });

  await context.close();
});
