import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { cartItems, db, notificationsFeed, products, users } from "@workspace/db";

const sent = vi.hoisted(() => ({ pushes: [] as Array<{ userId: string; category?: string; body: string }>, emails: [] as string[] }));

vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return {
    ...actual,
    sendPushToUser: async (userId: string, payload: { body: string }, category?: string) => {
      sent.pushes.push({ userId, category, body: payload.body });
      return true;
    },
  };
});
vi.mock("../../lib/brandthreadEmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/brandthreadEmail")>();
  return { ...actual, sendAbandonedCartEmail: async (o: { to: string }) => { sent.emails.push(o.to); return true; } };
});

const suffix = crypto.randomBytes(6).toString("hex");
const recent = `cart-recent-${suffix}`;      // 2h old → push only
const stale = `cart-stale-${suffix}`;        // 30h old → feed + email
const optedOut = `cart-optout-${suffix}`;    // 30h old, email off
const saved = `cart-saved-${suffix}`;        // saved for later → nothing
const fresh = `cart-fresh-${suffix}`;        // 10 minutes old → nothing
const gone = `cart-gone-${suffix}`;          // 2h old, product deleted → nothing
const ids = [recent, stale, optedOut, saved, fresh, gone];
let goneProductId = "";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const line = (name: string) => ({ productName: name, variantTitle: "M / Black", quantity: 1, priceCents: 4200 });

beforeAll(async () => {
  await db.insert(users).values(ids.map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId, role: "buyer", accountType: "buyer",
    notificationPreferences: clerkId === optedOut ? { "email:cart_reminders": false } : undefined,
  })));
  const [goneProduct] = await db.insert(products).values({
    ownerId: `cart-seller-${suffix}`, name: `cart-gone-${suffix}`, status: "active", deletedAt: new Date(),
  }).returning({ id: products.id });
  goneProductId = goneProduct.id;
  await db.insert(cartItems).values([
    { userId: gone, variantId: "v1", itemData: { ...line("Deleted Tee"), productId: goneProductId }, updatedAt: hoursAgo(2) },
    { userId: recent, variantId: "v1", itemData: line("Logo Tee"), updatedAt: hoursAgo(2) },
    { userId: recent, variantId: "v2", itemData: line("Cap"), updatedAt: hoursAgo(2) },
    { userId: stale, variantId: "v1", itemData: line("Hoodie"), updatedAt: hoursAgo(30) },
    { userId: optedOut, variantId: "v1", itemData: line("Hoodie"), updatedAt: hoursAgo(30) },
    { userId: saved, variantId: "v1", itemData: line("Tote"), savedForLater: true, updatedAt: hoursAgo(30) },
    { userId: fresh, variantId: "v1", itemData: line("Socks"), updatedAt: hoursAgo(0.2) },
  ]);
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ids));
  await db.delete(cartItems).where(inArray(cartItems.userId, ids));
  await db.delete(users).where(inArray(users.clerkId, ids));
  if (goneProductId) await db.delete(products).where(eq(products.id, goneProductId));
});

describe("runCartReminders", () => {
  it("pushes at 1h, emails at 24h, once per window, honouring switches", async () => {
    const { runCartReminders } = await import("../abandonedCartRecovery");
    await runCartReminders();
    await runCartReminders();

    const mine = sent.pushes.filter((p) => ids.includes(p.userId));
    expect(mine).toEqual([{ userId: recent, category: "cart", body: "Logo Tee and 1 more is waiting in your cart." }]);
    expect(sent.emails.filter((e) => e.includes(suffix)).sort()).toEqual([`${stale}@test.local`]);

    const feed = await db.select().from(notificationsFeed).where(inArray(notificationsFeed.userId, ids));
    const byUser = Object.fromEntries(feed.map((f) => [f.userId, f.type]));
    expect(byUser[recent]).toBe("cart_reminder");
    expect(byUser[stale]).toBe("abandoned_cart");
    expect(byUser[optedOut]).toBe("abandoned_cart");
    expect(byUser[saved]).toBeUndefined();
    expect(byUser[fresh]).toBeUndefined();
    expect(byUser[gone]).toBeUndefined(); // never nudge about a deleted product
  });
});
