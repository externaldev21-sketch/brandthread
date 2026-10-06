import { test, expect } from '@playwright/test';
import { pageAs, apiAs, BUYER, SELLER } from './socialHarness';

/**
 * Buyer ↔ seller DM, real API + Postgres + the /ws/user realtime channel
 * (see socialHarness.ts). The seller replies through the API (exactly what
 * the seller app sends); the buyer's open screens must update LIVE — the
 * inbox's own refresh is focus/30s-based and the thread's message poll is
 * 12s, so only the realtime hint gets them there within a few seconds —
 * and the seller's side must see the buyer's read receipts.
 */
const shots = process.env.SOCIAL_E2E_SHOTS ?? '../../docs/pr-assets/social-e2e';

async function lastSellerMessage(convId: string) {
  const msgs = (await apiAs<any[]>(SELLER, 'GET', `/api/conversations/${convId}/messages`)).body;
  return msgs.filter((m) => (m.fromId ?? m.senderId) === SELLER.id).at(-1);
}

test('seller replies reach the buyer live; the buyer reading them reaches the seller', async ({ browser }) => {
  test.setTimeout(300_000);
  const convs = (await apiAs<any[]>(BUYER, 'GET', '/api/conversations')).body;
  const conv = convs.find((c) => c.participants.some((p: any) => p.userId === SELLER.id))!;
  await apiAs(BUYER, 'PATCH', `/api/conversations/${conv.id}/read`);

  const buyer = await pageAs(browser, BUYER);
  await buyer.goto('/inbox', { waitUntil: 'load' });
  const row = buyer.getByTestId(`inbox-conversation-${conv.id}`);
  await expect(row).toBeVisible({ timeout: 90_000 });
  await buyer.waitForTimeout(2500);

  // 1) Seller replies → the buyer's inbox row updates live.
  const reply1 = `Yes — fully lined ${Date.now() % 10000}`;
  const t1 = Date.now();
  expect((await apiAs(SELLER, 'POST', `/api/conversations/${conv.id}/messages`, { text: reply1 })).status).toBe(201);
  await expect(row).toContainText(reply1.slice(0, 16), { timeout: 6_000 });
  const inboxLag = Date.now() - t1;
  await buyer.screenshot({ path: `${shots}/messaging-1-buyer-inbox-live.png` });

  // 2) Buyer opens the thread → the seller's message is Seen on the seller's side.
  await row.click();
  await expect(buyer.getByRole('button', { name: 'Message from Atelier North' }).filter({ hasText: reply1 })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await lastSellerMessage(conv.id))?.status, { timeout: 10_000 }).toBe('read');

  // 3) With the thread open, the next reply appears live AND is read live.
  const reply2 = `Ships tomorrow ${Date.now() % 10000}`;
  const t2 = Date.now();
  await apiAs(SELLER, 'POST', `/api/conversations/${conv.id}/messages`, { text: reply2 });
  await expect(buyer.getByRole('button', { name: 'Message from Atelier North' }).filter({ hasText: reply2 })).toBeVisible({ timeout: 6_000 });
  const threadLag = Date.now() - t2;
  await expect.poll(async () => (await lastSellerMessage(conv.id))?.status, { timeout: 8_000 }).toBe('read');
  // The seller's inbox data shows nothing unread for the buyer's side either.
  const buyerConv = (await apiAs<any[]>(BUYER, 'GET', '/api/conversations')).body.find((c) => c.id === conv.id);
  expect(buyerConv.unreadCount).toBe(0);
  await buyer.screenshot({ path: `${shots}/messaging-2-buyer-thread-live.png` });
  console.log(`[messaging] inbox updated in ${inboxLag}ms, open thread in ${threadLag}ms`);
});
