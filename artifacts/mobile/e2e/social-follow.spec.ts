import { test, expect } from '@playwright/test';
import { pageAs, apiAs, BUYER, SELLER } from './socialHarness';

/**
 * Follow, both sides, real API + Postgres (see socialHarness.ts).
 * Buyer follows/unfollows a seller from the seller's profile; the seller's
 * follower count + Activity reflect it (and the Activity row goes on
 * unfollow, even after it was read — QA-0037); the seller's post count is
 * real (was always 0 for sellers); the buyer's own Following count is the
 * server's exact number.
 */
const shots = process.env.SOCIAL_E2E_SHOTS ?? '../../docs/pr-assets/social-e2e';

async function sellerHasFollowerRow(): Promise<{ present: boolean; id?: string }> {
  const rows = (await apiAs<any>(SELLER, 'GET', '/api/buyer/notifications?limit=50')).body;
  const list = Array.isArray(rows) ? rows : rows.items ?? rows.notifications ?? [];
  const row = list.find((n: any) => n.type === 'new_follower' && n.actorId === BUYER.id);
  return { present: !!row, id: row?.id };
}

test('buyer follows and unfollows a seller; both sides agree; Activity and counts stay consistent', async ({ browser }) => {
  test.setTimeout(300_000);
  await apiAs(BUYER, 'DELETE', `/api/social/follow/${SELLER.id}`);

  const buyer = await pageAs(browser, BUYER);
  await buyer.goto(`/seller-profile?id=${SELLER.id}`, { waitUntil: 'load' });
  const followBtn = buyer.getByTestId('seller-profile-follow-btn');
  await expect(followBtn).toBeVisible({ timeout: 90_000 });
  await expect(followBtn).toContainText('Follow');
  await buyer.waitForTimeout(3000);
  await buyer.screenshot({ path: `${shots}/follow-1-seller-profile-before.png` });

  await followBtn.click();
  await expect(followBtn).toContainText('Following', { timeout: 15_000 });
  await expect.poll(async () => (await apiAs(SELLER, 'GET', `/api/social/profile/${SELLER.id}`)).body.followersCount).toBe(1);
  await expect.poll(async () => (await sellerHasFollowerRow()).present).toBe(true);

  // Real post count for a seller (was always 0) + follower count after reload.
  await buyer.reload({ waitUntil: 'load' });
  await expect(buyer.getByTestId('seller-profile-follow-btn')).toContainText('Following', { timeout: 90_000 });
  await buyer.waitForTimeout(3000);
  await buyer.screenshot({ path: `${shots}/follow-2-seller-profile-following.png` });
  expect((await apiAs(BUYER, 'GET', `/api/social/profile/${SELLER.id}`)).body).toMatchObject({ isFollowing: true, followersCount: 1, postsCount: 4 });

  // Seller reads the Activity row; the buyer unfollows; the row is gone anyway.
  const { id } = await sellerHasFollowerRow();
  if (id) await apiAs(SELLER, 'PATCH', `/api/buyer/notifications/${id}/read`);
  await buyer.getByTestId('seller-profile-follow-btn').click();
  await expect(buyer.getByTestId('seller-profile-follow-btn')).not.toContainText('Following', { timeout: 15_000 });
  await expect.poll(async () => (await sellerHasFollowerRow()).present).toBe(false);
  expect((await apiAs(SELLER, 'GET', `/api/social/profile/${SELLER.id}`)).body.followersCount).toBe(0);

  // Follow again; the buyer's own profile shows the server's exact Following count.
  await buyer.getByTestId('seller-profile-follow-btn').click();
  await expect(buyer.getByTestId('seller-profile-follow-btn')).toContainText('Following', { timeout: 15_000 });
  const mine = (await apiAs(BUYER, 'GET', `/api/social/profile/${BUYER.id}`)).body;
  await buyer.goto('/profile', { waitUntil: 'load' });
  await buyer.waitForTimeout(6000);
  const later = buyer.getByText('Maybe later', { exact: true });
  if (await later.isVisible().catch(() => false)) { await later.click(); await buyer.waitForTimeout(1500); }
  await buyer.screenshot({ path: `${shots}/follow-3-buyer-own-profile.png` });
  await expect(buyer.getByText(String(mine.followingCount), { exact: true }).first()).toBeVisible();
});
