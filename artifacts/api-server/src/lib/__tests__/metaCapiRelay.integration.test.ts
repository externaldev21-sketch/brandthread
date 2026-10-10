/** Meta CAPI events are credited to the product's seller, not the buyer (BT-325). */
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, metaAdAccounts, metaConversionEvents, orderItems, orders, productVariants, products, users } from "@workspace/db";

const sent = vi.hoisted(() => [] as Array<{ pixelId: string; params: any }>);
vi.mock("../metaCrypto", () => ({ decryptToken: (v: string) => `plain:${v}` }));
vi.mock("../metaGraph", async (orig) => ({
  ...(await orig<typeof import("../metaGraph")>()),
  sendConversionEvent: vi.fn(async (_token: string, pixelId: string, params: any) => { sent.push({ pixelId, params }); return { eventsReceived: 1 }; }),
}));
const { relayConversionEvent, normalizeCapiInput, sha256 } = await import("../metaCapiRelay");

const sfx = crypto.randomBytes(4).toString("hex");
const sellerA = `capi-${sfx}-a`;   // has a connected pixel
const sellerB = `capi-${sfx}-b`;   // no Meta account
const buyer = `capi-${sfx}-buyer`;
let pA = ""; let pB = ""; let vA = ""; let vB = "";
const now = new Date();
const iso = now.toISOString();

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerA, email: `${sellerA}@example.test`, name: "A", username: `capi_${sfx}_a`, accountType: "seller", onboardingComplete: true },
    { clerkId: sellerB, email: `${sellerB}@example.test`, name: "B", username: `capi_${sfx}_b`, accountType: "seller", onboardingComplete: true },
    { clerkId: buyer, email: `Buyer.${sfx}@Example.test`, name: "Buyer", username: `capi_${sfx}_u`, accountType: "buyer", onboardingComplete: true },
  ]);
  const [a] = await db.insert(products).values({ ownerId: sellerA, name: "Hoodie", status: "active" }).returning();
  const [b] = await db.insert(products).values({ ownerId: sellerB, name: "Cap", status: "active" }).returning();
  pA = a.id; pB = b.id;
  const [va] = await db.insert(productVariants).values({ productId: pA, sku: `capi-${sfx}-a`, priceCents: 6000 }).returning();
  const [vb] = await db.insert(productVariants).values({ productId: pB, sku: `capi-${sfx}-b`, priceCents: 2500 }).returning();
  vA = va.id; vB = vb.id;
  await db.insert(metaAdAccounts).values({ sellerId: sellerA, accessTokenEncrypted: "enc", pixelId: "PIXEL_A", status: "connected" });
});

beforeEach(() => { sent.length = 0; });

afterAll(async () => {
  const myOrders = await db.select({ id: orders.id }).from(orders).where(eq(orders.buyerId, buyer));
  if (myOrders.length) {
    await db.delete(orderItems).where(inArray(orderItems.orderId, myOrders.map((o) => o.id)));
    await db.delete(orders).where(inArray(orders.id, myOrders.map((o) => o.id)));
  }
  await db.delete(metaConversionEvents).where(inArray(metaConversionEvents.sellerId, [sellerA, sellerB, buyer]));
  await db.delete(metaAdAccounts).where(eq(metaAdAccounts.sellerId, sellerA));
  await db.delete(products).where(inArray(products.ownerId, [sellerA, sellerB]));
  await db.delete(users).where(inArray(users.clerkId, [sellerA, sellerB, buyer]));
});

describe("Meta CAPI relay (BT-325)", () => {
  it("credits ViewContent to the product's seller with the server-side price and hashed buyer match keys", async () => {
    const r = await relayConversionEvent({ eventId: `v-${sfx}`, eventName: "ViewContent", occurredAt: iso, productId: pA }, { viewerId: buyer, ip: "1.2.3.4", userAgent: "UA" });
    expect(r).toEqual({ ok: true, sellers: [{ sellerId: sellerA, sent: true, valueCents: 6000 }] });
    expect(sent).toHaveLength(1);
    expect(sent[0].pixelId).toBe("PIXEL_A");
    expect(sent[0].params.userData).toEqual({
      client_ip_address: "1.2.3.4", client_user_agent: "UA",
      em: sha256(`buyer.${sfx}@example.test`), external_id: sha256(buyer),
    });
    const rows = await db.select().from(metaConversionEvents).where(eq(metaConversionEvents.eventId, `v-${sfx}`));
    expect(rows.map((x) => x.sellerId)).toEqual([sellerA]); // never stored under the buyer
  });

  it("works for guests (no match keys) and dedupes on the event id", async () => {
    await relayConversionEvent({ eventId: `g-${sfx}`, eventName: "ViewContent", occurredAt: iso, productId: pA }, { viewerId: null });
    expect(sent[0].params.userData.em).toBeUndefined();
    const again = await relayConversionEvent({ eventId: `g-${sfx}`, eventName: "ViewContent", occurredAt: iso, productId: pA }, { viewerId: null });
    expect(again).toMatchObject({ ok: true, sellers: [{ sellerId: sellerA, sent: false }] });
    expect(sent).toHaveLength(1);
  });

  it("only relays a Purchase that a paid order backs, valued at that seller's share", async () => {
    const before = await relayConversionEvent({ eventId: `p0-${sfx}`, eventName: "Purchase", occurredAt: iso, productIds: [pA, pB] }, { viewerId: buyer });
    expect(before).toEqual({ ok: true, sellers: [] });

    const [order] = await db.insert(orders).values({ buyerId: buyer, orderNumber: `BT-${sfx}`, totalCents: 14500, subtotalCents: 14500, paidAt: new Date(), status: "paid" } as any).returning();
    await db.insert(orderItems).values([
      { orderId: order.id, variantId: vA, productName: "Hoodie", quantity: 2, priceCents: 6000 },
      { orderId: order.id, variantId: vB, productName: "Cap", quantity: 1, priceCents: 2500 },
    ]);
    const r = await relayConversionEvent({ eventId: `p1-${sfx}`, eventName: "Purchase", occurredAt: iso, productIds: [pA, pB] }, { viewerId: buyer });
    expect(r.ok && [...r.sellers].sort((x, y) => x.sellerId.localeCompare(y.sellerId))).toEqual([
      { sellerId: sellerA, sent: true, valueCents: 12000 },
      { sellerId: sellerB, sent: false, valueCents: 2500 }, // recorded; no pixel connected
    ]);
    expect(sent[0].params.customData).toMatchObject({ content_ids: [pA], value: 120, currency: "USD" });
    const bRows = await db.select().from(metaConversionEvents)
      .where(and(eq(metaConversionEvents.sellerId, sellerB), eq(metaConversionEvents.eventId, `p1-${sfx}`)));
    expect(bRows).toHaveLength(1);
  });

  it("rejects malformed or stale events", () => {
    expect(normalizeCapiInput({ eventId: "x", eventName: "Hack", occurredAt: iso })).toBeNull();
    expect(normalizeCapiInput({ eventId: "", eventName: "Purchase", occurredAt: iso })).toBeNull();
    expect(normalizeCapiInput({ eventId: "x", eventName: "Purchase", occurredAt: new Date(Date.now() - 9 * 86_400_000).toISOString() })).toBeNull();
    expect(normalizeCapiInput({ eventId: "x", eventName: "ViewContent", occurredAt: iso, productIds: ["nope", pA, pA] })?.productIds).toEqual([pA]);
  });
});
