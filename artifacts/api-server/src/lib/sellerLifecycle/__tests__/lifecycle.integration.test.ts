import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, orderItems, orders, products, sellerLifecycleMessages, storeVisits, users } from "@workspace/db";

const publish = vi.fn().mockResolvedValue(undefined);
const sendEmail = vi.fn().mockResolvedValue(true);
vi.mock("../../../routes/notifications-feed", () => ({ publishNotification: (...a: unknown[]) => publish(...a) }));
vi.mock("../../brandthreadEmail", async (orig) => ({
  ...(await orig<typeof import("../../brandthreadEmail")>()),
  sendBrandthreadEmail: (...a: unknown[]) => sendEmail(...a),
}));

const { runSellerActivationNudges } = await import("../../../jobs/sellerActivationNudges");
const { runSellerWeeklySummary } = await import("../../../jobs/sellerWeeklySummary");
const { notifySellerCheckoutBlocked } = await import("../checkoutBlocked");
const { mirrorSellerEmail } = await import("../mirror");

const suffix = crypto.randomBytes(5).toString("hex");
const id = (name: string) => `life-${name}-${suffix}`;
const HOUR = 3_600_000;
const now = new Date("2026-10-12T16:30:00Z"); // Monday 9:30 in Los Angeles
const sellers: string[] = [];
const productIds: string[] = [];
const orderIds: string[] = [];

async function seller(name: string, fields: Record<string, unknown>) {
  const clerkId = id(name);
  sellers.push(clerkId);
  await db.insert(users).values({
    clerkId, email: `${clerkId}@test.local`, name, accountType: "seller", onboardingComplete: true, ...fields,
  } as any);
  return clerkId;
}

async function product(ownerId: string, status = "active") {
  const [p] = await db.insert(products).values({ ownerId, name: `Tee ${suffix}`, category: "apparel", status } as any).returning({ id: products.id });
  productIds.push(p.id);
  return p.id;
}

const callsFor = (mock: ReturnType<typeof vi.fn>, key: "userId" | "to", value: string) =>
  mock.mock.calls.filter(([arg]) => (arg as any)[key] === value);

beforeEach(() => { publish.mockClear(); sendEmail.mockClear(); });

afterAll(async () => {
  if (orderIds.length) {
    await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
    await db.delete(orders).where(inArray(orders.id, orderIds));
  }
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(storeVisits).where(inArray(storeVisits.sellerId, sellers));
  await db.delete(sellerLifecycleMessages).where(inArray(sellerLifecycleMessages.sellerId, sellers));
  await db.delete(users).where(inArray(users.clerkId, sellers));
});

describe("activation nudges job", () => {
  it("nudges a seller with no product after a day, once", async () => {
    const s = await seller("noproduct", { createdAt: new Date(now.getTime() - 30 * HOUR) });
    await runSellerActivationNudges(now);
    expect(callsFor(publish, "userId", s)).toEqual([[expect.objectContaining({
      type: "seller_nudge_no_product", targetType: "seller_setup", targetId: "/add-product",
    })]]);
    expect(callsFor(sendEmail, "to", `${s}@test.local`)).toHaveLength(1);

    publish.mockClear(); sendEmail.mockClear();
    await runSellerActivationNudges(new Date(now.getTime() + HOUR));
    expect(callsFor(publish, "userId", s)).toHaveLength(0);
    expect(callsFor(sendEmail, "to", `${s}@test.local`)).toHaveLength(0);
  });

  it("asks for payouts when a product is live but payouts aren't", async () => {
    const s = await seller("nopayouts", { createdAt: new Date(now.getTime() - 50 * HOUR) });
    await product(s);
    await runSellerActivationNudges(now);
    expect(callsFor(publish, "userId", s)[0][0]).toMatchObject({ type: "seller_nudge_no_payouts", targetId: "/payouts" });
  });

  it("emails an abandoned onboarding without a push, and honours the email switch", async () => {
    const s = await seller("abandoned", { onboardingComplete: false, brandName: "Halo", createdAt: new Date(now.getTime() - 3 * HOUR) });
    const off = await seller("abandoned-off", {
      onboardingComplete: false, brandName: "Halo", createdAt: new Date(now.getTime() - 3 * HOUR),
      notificationPreferences: { "email:seller_tips": false },
    });
    await runSellerActivationNudges(now);
    expect(callsFor(publish, "userId", s)).toHaveLength(0);
    expect(callsFor(sendEmail, "to", `${s}@test.local`)[0][0]).toMatchObject({ subject: "Finish setting up your store" });
    expect(callsFor(sendEmail, "to", `${off}@test.local`)).toHaveLength(0);
  });
});

describe("weekly summary job", () => {
  it("sends Monday 9am local with the week's numbers, once per week", async () => {
    const s = await seller("weekly", { quietHoursTimezone: "America/Los_Angeles", createdAt: new Date("2026-09-01T00:00:00Z") });
    const pid = await product(s);
    const [o] = await db.insert(orders).values({
      ownerId: s, orderNumber: `W-${suffix}`, status: "processing", totalCents: 4_500, subtotalCents: 4_500,
      paidAt: new Date(now.getTime() - 2 * 24 * HOUR),
    } as any).returning({ id: orders.id });
    orderIds.push(o.id);
    await db.insert(orderItems).values({ orderId: o.id, productName: "Halo Tee", quantity: 2, priceCents: 2_250 } as any);
    const visitAt = new Date(now.getTime() - 24 * HOUR);
    await db.insert(storeVisits).values([{ sellerId: s, productId: pid, source: "direct", createdAt: visitAt }, { sellerId: s, source: "direct", createdAt: visitAt }] as any);

    await runSellerWeeklySummary(now);
    const email = callsFor(sendEmail, "to", `${s}@test.local`);
    expect(email).toHaveLength(1);
    expect(email[0][0]).toMatchObject({ subject: "Your week on Brandthread: $45.00 in sales" });
    expect((email[0][0] as any).html).toContain("Halo Tee (2 sold)");
    expect(callsFor(publish, "userId", s)[0][0]).toMatchObject({ type: "seller_weekly_summary", targetId: "/(tabs)/orders" });

    sendEmail.mockClear();
    await runSellerWeeklySummary(new Date(now.getTime() + 10 * 60_000));
    expect(callsFor(sendEmail, "to", `${s}@test.local`)).toHaveLength(0);
  });

  it("skips sellers whose Monday 9am hasn't come", async () => {
    const s = await seller("weekly-ny", { quietHoursTimezone: "America/New_York" });
    await product(s);
    await runSellerWeeklySummary(now);
    expect(callsFor(sendEmail, "to", `${s}@test.local`)).toHaveLength(0);
  });
});

describe("checkout blocked alert", () => {
  it("tells the seller once a day", async () => {
    const s = await seller("blocked", {});
    expect(await notifySellerCheckoutBlocked(s, now)).toBe(true);
    expect(await notifySellerCheckoutBlocked(s, new Date(now.getTime() + HOUR))).toBe(false);
    expect(callsFor(publish, "userId", s)).toEqual([[expect.objectContaining({ type: "checkout_blocked_no_payouts", targetType: "payout" })]]);
    expect(callsFor(sendEmail, "to", `${s}@test.local`)).toHaveLength(1);
    expect(await notifySellerCheckoutBlocked(s, new Date(now.getTime() + 25 * HOUR))).toBe(true);
  });
});

describe("seller email mirror", () => {
  it("emails a new order with its total, and respects the email switch", async () => {
    const s = await seller("mirror", {});
    const quiet = await seller("mirror-off", { notificationPreferences: { "email:new_orders": false } });
    const [o] = await db.insert(orders).values({
      ownerId: s, orderNumber: `M-${suffix}`, status: "processing", totalCents: 9_900, subtotalCents: 9_900,
    } as any).returning({ id: orders.id });
    orderIds.push(o.id);
    expect(await mirrorSellerEmail({ userId: s, type: "new_order_received", targetId: o.id })).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: `${s}@test.local`, subject: `New order #M-${suffix} for $99.00`, idempotencyKey: `seller-new_order_received/${o.id}`,
    }));
    expect(await mirrorSellerEmail({ userId: quiet, type: "new_order_received", targetId: o.id })).toBe(false);
  });
});
