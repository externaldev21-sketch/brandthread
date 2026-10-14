/**
 * Brand membership levels, against real Postgres:
 *  - Member → Insider → Inner Circle from lifetime spend with that brand
 *    (paid, not cancelled, net of refunds, never the seller's own orders);
 *  - the seller's thresholds (defaults otherwise) and their validation;
 *  - /mine and /brand/:sellerId return only the caller's own levels;
 *  - Inner Circle early access opens a scheduled launch early for Inner
 *    Circle buyers only, at checkout and in the public lobby state.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const who = req.header("x-test-user");
    if (!who) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = who;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../middlewares/requireRole")>()),
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../safety", async (orig) => {
  const actual: any = await orig();
  return { ...actual, optionalViewerId: (req: any) => req.header("x-test-user") || null };
});

import { db, orders, productLaunches } from "@workspace/db";
import {
  DEFAULT_SETTINGS, earlyAccessMinutesFor, levelFor, membershipFor, nextLevel, validateSettings,
} from "../brandMembership";
import { unlaunchedProductIds } from "../productLaunch";
import { seedBuyer, seedProduct, seedSeller, startApp, uid } from "../money/__tests__/moneyHarness";
import membershipRouter from "../../routes/brand-membership";
import launchesRouter from "../../routes/product-launches";

let app: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/brand-membership", membershipRouter);
    server.use("/api/product-launches", launchesRouter);
  });
});
afterAll(async () => { await app.close(); });

async function call(p: string, user: string | null, method = "GET", body?: unknown) {
  const res = await fetch(`${app.base}${p}`, {
    method,
    headers: { ...(user ? { "x-test-user": user } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

async function order(sellerId: string, buyerId: string, totalCents: number, extra: Partial<typeof orders.$inferInsert> = {}) {
  await db.insert(orders).values({
    ownerId: sellerId, buyerId, orderNumber: uid("BT"), status: "processing", totalCents, subtotalCents: totalCents, paidAt: new Date(), ...extra,
  });
}

describe("levels (pure)", () => {
  it("maps spend to a level at the thresholds, and says what's next", () => {
    const s = { insiderCents: 25_000, innerCircleCents: 100_000 };
    expect(levelFor(0, s)).toBeNull();
    expect(levelFor(1, s)).toBe("member");
    expect(levelFor(24_999, s)).toBe("member");
    expect(levelFor(25_000, s)).toBe("insider");
    expect(levelFor(100_000, s)).toBe("inner_circle");
    expect(nextLevel(10_000, s)).toEqual({ level: "insider", remainingCents: 15_000 });
    expect(nextLevel(40_000, s)).toEqual({ level: "inner_circle", remainingCents: 60_000 });
    expect(nextLevel(100_000, s)).toBeNull();
    expect(nextLevel(0, s)).toBeNull();
  });

  it("validates seller thresholds", () => {
    expect(validateSettings({ insiderCents: 10_000, innerCircleCents: 50_000, innerCircleEarlyAccessMinutes: 60 }).ok).toBe(true);
    expect(validateSettings({ insiderCents: 50_000, innerCircleCents: 50_000 })).toMatchObject({ ok: false });
    expect(validateSettings({ insiderCents: 0, innerCircleCents: 50_000 })).toMatchObject({ ok: false });
    expect(validateSettings({ insiderCents: 100, innerCircleCents: 20_000_000 })).toMatchObject({ ok: false });
    expect(validateSettings({ insiderCents: 100, innerCircleCents: 200, innerCircleEarlyAccessMinutes: 2000 })).toMatchObject({ ok: false });
    expect(validateSettings({ insiderCents: 10.5, innerCircleCents: 200 })).toMatchObject({ ok: false });
  });
});

describe("lifetime spend and routes", () => {
  it("counts paid, uncancelled spend net of refunds with that brand only", async () => {
    const brand = await seedSeller("lv-brand");
    const other = await seedSeller("lv-other");
    const buyer = await seedBuyer("lv-buyer");
    await order(brand, buyer, 20_000);
    await order(brand, buyer, 10_000, { refundedCents: 4_000 }); // counts 6,000
    await order(brand, buyer, 90_000, { status: "cancelled" });   // never counts
    await order(brand, buyer, 50_000, { paidAt: null });          // unpaid never counts
    await order(other, buyer, 500_000);                           // another brand
    const m = await membershipFor(brand, buyer);
    expect(m).toMatchObject({ level: "insider", spendCents: 26_000, next: { level: "inner_circle", remainingCents: 74_000 } });
    expect((await membershipFor(other, buyer)).level).toBe("inner_circle");
  });

  it("uses the seller's own thresholds once set, and only the caller's levels are readable", async () => {
    const brand = await seedSeller("lv-custom");
    const buyer = await seedBuyer("lv-custom");
    await order(brand, buyer, 15_000);
    expect((await call(`/api/brand-membership/brand/${brand}`, buyer)).body.level).toBe("member");

    expect((await call(`/api/brand-membership/settings`, brand)).body).toEqual(DEFAULT_SETTINGS);
    expect((await call(`/api/brand-membership/settings`, brand, "PUT", { insiderCents: 10_000, innerCircleCents: 15_000 })).status).toBe(200);
    expect((await call(`/api/brand-membership/settings`, brand, "PUT", { insiderCents: 20_000, innerCircleCents: 15_000 })).status).toBe(400);
    expect((await call(`/api/brand-membership/brand/${brand}`, buyer)).body.level).toBe("inner_circle");

    const mine = (await call(`/api/brand-membership/mine`, buyer)).body.brands;
    expect(mine).toEqual([expect.objectContaining({ sellerId: brand, level: "inner_circle", spendCents: 15_000 })]);
    // No way to read someone else's levels: /mine is always the caller.
    expect((await call(`/api/brand-membership/mine`, null)).status).toBe(401);
    // A seller has no level at their own brand.
    expect((await call(`/api/brand-membership/brand/${brand}`, brand)).body.level).toBeNull();
  });
});

describe("Inner Circle early access", () => {
  it("opens a scheduled launch early for Inner Circle buyers only", async () => {
    const brand = await seedSeller("lv-early");
    const inner = await seedBuyer("lv-inner");
    const insider = await seedBuyer("lv-insider");
    await order(brand, inner, 120_000);
    await order(brand, insider, 30_000);
    const product = await seedProduct(brand, { priceCents: 5_000, stock: 5 });
    const launchAt = new Date(Date.now() + 30 * 60_000); // opens in 30 min
    await db.insert(productLaunches).values({ productId: product.productId, launchAt });

    // Off by default: nobody is early.
    expect(await earlyAccessMinutesFor(brand, inner)).toBe(0);
    expect(await unlaunchedProductIds([product.productId], new Date(), db, inner)).toEqual([product.productId]);

    await call(`/api/brand-membership/settings`, brand, "PUT", { insiderCents: 25_000, innerCircleCents: 100_000, innerCircleEarlyAccessMinutes: 60 });
    expect(await earlyAccessMinutesFor(brand, inner)).toBe(60);
    expect(await earlyAccessMinutesFor(brand, insider)).toBe(0);

    // Checkout gate: open for Inner Circle, still closed for everyone else.
    expect(await unlaunchedProductIds([product.productId], new Date(), db, inner)).toEqual([]);
    expect(await unlaunchedProductIds([product.productId], new Date(), db, insider)).toEqual([product.productId]);
    expect(await unlaunchedProductIds([product.productId], new Date(), db, null)).toEqual([product.productId]);

    // Lobby state: Inner Circle sees it open; others see the public time.
    const forInner = (await call(`/api/product-launches/${product.productId}`, inner)).body;
    expect(forInner).toMatchObject({ launching: false, launchAt: null });
    const forInsider = (await call(`/api/product-launches/${product.productId}`, insider)).body;
    expect(forInsider).toMatchObject({ launching: true, launchAt: launchAt.toISOString(), earlyAccess: false });
    const anon = (await call(`/api/product-launches/${product.productId}`, null)).body;
    expect(anon).toMatchObject({ launching: true, launchAt: launchAt.toISOString() });

    // With 15 minutes of early access the Inner Circle lobby counts down to 15 minutes earlier.
    await call(`/api/brand-membership/settings`, brand, "PUT", { insiderCents: 25_000, innerCircleCents: 100_000, innerCircleEarlyAccessMinutes: 15 });
    const early15 = (await call(`/api/product-launches/${product.productId}`, inner)).body;
    expect(early15).toMatchObject({ launching: true, earlyAccess: true, launchAt: new Date(launchAt.getTime() - 15 * 60_000).toISOString() });
  });
});
