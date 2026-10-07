import { test, expect } from '@playwright/test';
import { pageAs, apiAs, BUYER, SELLER } from './socialHarness';

/**
 * Stories, both sides, real API + Postgres (see socialHarness.ts).
 *  - Every story the buyer actually watches counts as a view for the seller
 *    (only the first one did), and the seller never counts as their own viewer.
 *  - A reply from the viewer lands in the seller's DMs with the slide and a
 *    "replied to your story" Activity row.
 */
const shots = process.env.SOCIAL_E2E_SHOTS ?? '../../docs/pr-assets/social-e2e';

test('buyer watches two seller stories and replies; seller sees both views and the reply', async ({ browser }) => {
  test.setTimeout(300_000);
  const tray = (await apiAs<any[]>(BUYER, 'GET', '/api/social/stories/following')).body;
  const ids: string[] = tray.find((t) => t.authorId === SELLER.id).storyIds;
  expect(ids.length).toBeGreaterThanOrEqual(2);

  const buyer = await pageAs(browser, BUYER);
  await buyer.goto(`/buyer-story-viewer?storyId=${ids[0]}&allStoryIds=${ids.join(',')}`, { waitUntil: 'load' });
  const reply = buyer.getByPlaceholder('Reply to Atelier North…');
  await expect(reply).toBeVisible({ timeout: 90_000 });
  const guide = buyer.getByText('TAP TO KEEP WATCHING', { exact: false });
  if (await guide.isVisible().catch(() => false)) { await guide.click(); await buyer.waitForTimeout(600); }
  await buyer.screenshot({ path: `${shots}/stories-1-buyer-viewer.png` });

  // First story counted; tap the right edge to advance to the second.
  await expect.poll(async () => (await apiAs<any>(SELLER, 'GET', `/api/social/stories/${ids[0]}/viewers`)).body
    .map((v: any) => v.userId ?? v.id)).toContain(BUYER.id);
  await buyer.mouse.click(370, 400);
  await expect.poll(async () => (await apiAs<any>(SELLER, 'GET', `/api/social/stories/${ids[1]}/viewers`)).body
    .map((v: any) => v.userId ?? v.id), { timeout: 15_000 }).toContain(BUYER.id);

  // Reply from the viewer.
  const text = `Is this coat restocking? ${Date.now() % 10000}`;
  await reply.fill(text);
  await reply.press('Enter');
  await expect.poll(async () => {
    const convs = (await apiAs<any[]>(SELLER, 'GET', '/api/conversations')).body;
    const conv = convs.find((c) => c.participants.some((p: any) => p.userId === BUYER.id) && c.lastMessage === 'Replied to your story');
    if (!conv) return false;
    const msgs = (await apiAs<any[]>(SELLER, 'GET', `/api/conversations/${conv.id}/messages`)).body;
    const last = msgs.at(-1);
    return last?.text === text && last?.attachment?.type === 'story_reply';
  }, { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => {
    const rows = (await apiAs<any>(SELLER, 'GET', '/api/buyer/notifications?limit=50')).body;
    const list = Array.isArray(rows) ? rows : rows.items ?? rows.notifications ?? [];
    return list.some((n: any) => n.type === 'story_reply' && n.actorId === BUYER.id);
  }).toBe(true);

  // The seller opening their own story is not a view.
  const before = (await apiAs<any>(SELLER, 'GET', `/api/social/stories/${ids[0]}/viewers`)).body.length;
  await apiAs(SELLER, 'POST', `/api/social/stories/${ids[0]}/view`);
  const viewers = (await apiAs<any>(SELLER, 'GET', `/api/social/stories/${ids[0]}/viewers`)).body;
  expect(viewers.length).toBe(before);
  expect(viewers.map((v: any) => v.userId ?? v.id)).not.toContain(SELLER.id);

  // Seller's Activity shows the reply.
  const seller = await pageAs(browser, SELLER);
  await seller.goto('/activity-center', { waitUntil: 'load' });
  await expect(seller.getByText(/replied to your story/).first()).toBeVisible({ timeout: 60_000 });
  await seller.screenshot({ path: `${shots}/stories-2-seller-activity.png` });
});
