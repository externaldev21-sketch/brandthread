/**
 * Draws for limited drops, against real Postgres with the in-memory Stripe:
 *  - draw order is a fair, seed-determined shuffle that anyone can re-derive
 *    from the revealed seed (whose hash was fixed up front);
 *  - while a draw is open the product can't be bought through checkout;
 *  - entering authorises (manual capture), never charges; one entry each;
 *  - the draw captures winners (one per unit of stock per size), hands a
 *    failed capture's unit to the next entry, cancels every other hold, and
 *    the existing cart webhook turns each capture into an order;
 *  - the audit log records each step; re-running never draws twice;
 *  - seller cancel releases every hold; the feature flag gates everything.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../money/__tests__/fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../push")>()),
  sendPushToUser: async (...args: unknown[]) => { pushes.push(args); },
  stableNotificationId: (...parts: string[]) => parts.join(":"),
}));
vi.mock("../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
  sendOrderShippingEmail: async () => true,
  sendReturnStatusEmail: async () => true,
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.headers["x-test-user"];
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../middlewares/requireRole")>()),
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const pushes = vi.hoisted(() => [] as unknown[][]);

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, buyerAddresses, checkoutSessions, notificationsFeed, orders, pool, productDrawEntries, productDrawEvents,
  productDraws, productLaunches, productVariants,
} from "@workspace/db";
import { fake } from "../money/__tests__/fakeStripe";
import { seedBuyer, seedProduct, seedSeller, startApp, uid } from "../money/__tests__/moneyHarness";
import { CartCheckoutError, priceCartGroup } from "../money/cartCheckout";
import { allocate, drawOrder, runProductDraws, seedHash, validateDrawWindow } from "../productDraws";
import { handleCartPaymentSucceeded } from "../../routes/webhooks";
import drawsRouter from "../../routes/product-draws";

const MIN = 60_000;
let app: Awaited<ReturnType<typeof startApp>>;
let flagBefore: boolean | null = null;

async function setFlag(enabled: boolean) {
  await pool.query(
    `INSERT INTO feature_flags (key, enabled, description) VALUES ('productDraws', $1, '')
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [enabled],
  );
}

beforeAll(async () => {
  const r = await pool.query<{ enabled: boolean }>(`SELECT enabled FROM feature_flags WHERE key = 'productDraws'`);
  flagBefore = r.rows[0]?.enabled ?? null;
  await setFlag(true);
  app = await startApp((server) => {
    server.use("/api/product-draws", drawsRouter);
    server.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: String(err?.stack ?? err) }); });
  });
});
afterAll(async () => {
  await app.close();
  if (flagBefore === null) await pool.query(`DELETE FROM feature_flags WHERE key = 'productDraws'`);
  else await setFlag(flagBefore);
});
beforeEach(() => { fake.reset(); pushes.length = 0; });

async function api(path: string, user: string | undefined, method = "GET", body?: unknown) {
  const res = await fetch(`${app.base}${path}`, {
    method,
    headers: { ...(user ? { "x-test-user": user } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

async function buyerWithAddress(tag: string) {
  const buyer = await seedBuyer(tag);
  const [address] = await db.insert(buyerAddresses).values({
    buyerId: buyer, recipientName: `Buyer ${tag}`, street: "148 Mercer Street", city: "New York", state: "NY",
    postalCode: "10012", country: "US", phone: "+1 503 555 0100", isDefault: true,
  }).returning();
  return { buyer, addressId: address.id };
}

/** A launched product with `stock` units of size M, set to draw mode closing in an hour. */
async function seedDraw(tag: string, stock: number) {
  const seller = await seedSeller(tag);
  const product = await seedProduct(seller, { priceCents: 20_000, stock });
  await db.insert(productLaunches).values({ productId: product.productId, launchAt: new Date(Date.now() - MIN), launchedAt: new Date() });
  const closesAt = new Date(Date.now() + 60 * MIN);
  const put = await api(`/api/product-draws/${product.productId}`, seller, "PUT", { entryClosesAt: closesAt.toISOString() });
  expect(put.status).toBe(200);
  return { seller, ...product, closesAt };
}

/** Enter and have the "app" confirm the card. */
async function enter(productId: string, variantId: string, who: { buyer: string; addressId: string }, notifyResult = false) {
  const res = await api(`/api/product-draws/${productId}/entry`, who.buyer, "POST", { variantId, addressId: who.addressId, notifyResult });
  expect(res.status).toBe(200);
  const intentId = String(res.body.clientSecret).replace(/_secret_test$/, "");
  fake.state.paymentIntents.get(intentId).status = "requires_capture";
  const confirm = await api(`/api/product-draws/${productId}/entry/confirm`, who.buyer, "POST");
  expect(confirm.body).toEqual({ status: "entered" });
  return intentId;
}

describe("draw order and allocation (pure)", () => {
  it("is a permutation fixed by the seed, and changes with it", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `entry-${i}`);
    const a = drawOrder("seed-a", ids);
    expect([...a].sort()).toEqual([...ids].sort());
    expect(drawOrder("seed-a", [...ids].reverse())).toEqual(a); // entry order doesn't matter
    expect(drawOrder("seed-b", ids)).not.toEqual(a);
  });

  it("gives every position a fair chance across seeds", () => {
    const ids = ["a", "b", "c", "d"];
    const firsts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const first = drawOrder(crypto.randomBytes(16).toString("hex"), ids)[0];
      firsts.set(first, (firsts.get(first) ?? 0) + 1);
    }
    for (const id of ids) expect(firsts.get(id)!).toBeGreaterThan(850); // ~1000 each
  });

  it("caps the window at 10 minutes to 5 days", () => {
    const launch = new Date("2026-10-20T17:00:00Z");
    const now = new Date("2026-10-19T00:00:00Z");
    expect(validateDrawWindow(launch, new Date(launch.getTime() + 5 * MIN), now)).toMatch(/10 minutes/);
    expect(validateDrawWindow(launch, new Date(launch.getTime() + 6 * 24 * 60 * MIN), now)).toMatch(/5 days/);
    expect(validateDrawWindow(launch, new Date(launch.getTime() + 60 * MIN), now)).toBeNull();
  });

  it("moves a unit to the next entry when a payment fails, per size", async () => {
    const ranked = [
      { id: "1", variantId: "M" }, { id: "2", variantId: "M" }, { id: "3", variantId: "M" }, { id: "4", variantId: "L" },
    ];
    const res = await allocate(ranked, new Map([["M", 1], ["L", 0]]), async (e) => e.id !== "1");
    expect(res.won.map((e) => e.id)).toEqual(["2"]);
    expect(res.failed.map((e) => e.id)).toEqual(["1"]);
    expect(res.lost.map((e) => e.id)).toEqual(["3", "4"]);
  });
});

describe("draw lifecycle", () => {
  it("blocks checkout, authorises entries, charges winners only, logs it, runs once", async () => {
    const d = await seedDraw("life", 2);

    // Public state, no secrets.
    const pub = await api(`/api/product-draws/${d.productId}`, undefined);
    expect(pub.body.draw).toMatchObject({ status: "open", productId: d.productId });
    expect(pub.body.draw.seed).toBeUndefined();

    // Normal checkout is closed while the draw is open.
    await expect(priceCartGroup({
      buyerId: "anyone", items: [{ variantId: d.variantId, productId: d.productId, quantity: 1 }],
      shipping: { name: "x", street: "1 St", line2: null, city: "NY", state: "NY", zip: "10012", country: "US", phone: "" },
    })).rejects.toMatchObject({ code: "DRAW_ONLY" } satisfies Partial<CartCheckoutError>);

    const people = await Promise.all(["p1", "p2", "p3", "p4", "p5"].map((t) => buyerWithAddress(`life-${t}`)));

    // Entering creates a manual-capture intent with the cart webhook kind.
    const first = await api(`/api/product-draws/${d.productId}/entry`, people[0].buyer, "POST", { variantId: d.variantId, addressId: people[0].addressId, notifyResult: true });
    expect(first.status).toBe(200);
    const create = fake.state.paymentIntentCreates.at(-1)!.params;
    expect(create).toMatchObject({ capture_method: "manual", amount: first.body.amountCents, metadata: { kind: "cart_checkout", drawEntryId: first.body.entryId } });
    // Not counted until the card is authorised.
    expect((await api(`/api/product-draws/${d.productId}/entry/confirm`, people[0].buyer, "POST")).status).toBe(402);
    fake.state.paymentIntents.get(String(first.body.clientSecret).replace(/_secret_test$/, "")).status = "requires_capture";
    expect((await api(`/api/product-draws/${d.productId}/entry/confirm`, people[0].buyer, "POST")).body).toEqual({ status: "entered" });
    // One entry per person.
    expect((await api(`/api/product-draws/${d.productId}/entry`, people[0].buyer, "POST", { variantId: d.variantId, addressId: people[0].addressId })).body.code).toBe("ALREADY_ENTERED");

    const intents = new Map<string, string>([[people[0].buyer, String(first.body.clientSecret).replace(/_secret_test$/, "")]]);
    for (const p of people.slice(1)) intents.set(p.buyer, await enter(d.productId, d.variantId, p));

    // p5 withdraws: hold released.
    expect((await api(`/api/product-draws/${d.productId}/entry`, people[4].buyer, "DELETE")).body).toEqual({ status: "withdrawn" });
    expect(fake.state.paymentIntents.get(intents.get(people[4].buyer)!).status).toBe("canceled");

    // Nothing has been charged yet.
    for (const id of intents.values()) expect(fake.state.paymentIntents.get(id).status).not.toBe("succeeded");

    // Too early: nothing happens.
    expect(await runProductDraws(fake.stripe as any, new Date(d.closesAt.getTime() - 1000))).toEqual({ drawn: 0 });

    // Whoever ranks first will have their capture declined: the unit moves on.
    const entered = await db.select().from(productDrawEntries).where(and(eq(productDrawEntries.productId, d.productId), eq(productDrawEntries.status, "entered")));
    const [draw] = await db.select().from(productDraws).where(eq(productDraws.productId, d.productId));
    const expectedOrder = drawOrder(draw.seed, entered.map((e) => e.id));
    const firstRanked = entered.find((e) => e.id === expectedOrder[0])!;
    fake.state.captureFails.add(firstRanked.stripePaymentIntentId!);

    const stockBefore = (await db.select({ s: productVariants.stock }).from(productVariants).where(eq(productVariants.id, d.variantId)))[0].s;
    expect(await runProductDraws(fake.stripe as any, new Date(d.closesAt.getTime() + 1000))).toEqual({ drawn: 1 });
    // Exactly once.
    expect(await runProductDraws(fake.stripe as any, new Date(d.closesAt.getTime() + 60_000))).toEqual({ drawn: 0 });

    const after = await db.select().from(productDrawEntries).where(eq(productDrawEntries.productId, d.productId));
    const byId = new Map(after.map((e) => [e.id, e]));
    const winners = expectedOrder.slice(1, 3);
    const losers = expectedOrder.slice(3);
    expect(byId.get(expectedOrder[0])!.status).toBe("charge_failed");
    for (const id of winners) expect(byId.get(id)!.status).toBe("won");
    for (const id of losers) expect(byId.get(id)!.status).toBe("lost");
    expect(after.filter((e) => e.status === "won")).toHaveLength(2);

    // Winners captured, everyone else released.
    for (const id of winners) expect(fake.state.paymentIntents.get(byId.get(id)!.stripePaymentIntentId!).status).toBe("succeeded");
    for (const id of [expectedOrder[0], ...losers]) expect(fake.state.paymentIntents.get(byId.get(id)!.stripePaymentIntentId!).status).toBe("canceled");

    // Two units held for the winners; the failed capture's hold was given back.
    const stockAfter = (await db.select({ s: productVariants.stock }).from(productVariants).where(eq(productVariants.id, d.variantId)))[0].s;
    expect(stockBefore - stockAfter).toBe(2);
    expect(await db.select().from(checkoutSessions).where(eq(checkoutSessions.clientIdempotencyKey, `draw_${expectedOrder[0]}`))).toHaveLength(0);

    // The existing cart webhook makes each winner's order.
    for (const id of winners) {
      const intent = fake.state.paymentIntents.get(byId.get(id)!.stripePaymentIntentId!);
      await handleCartPaymentSucceeded(intent, `evt_${id}`, new Date());
      const [order] = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, intent.id));
      expect(order).toBeTruthy();
      expect(order.totalCents).toBe(byId.get(id)!.amountCents);
    }

    // Audit log: seed revealed, matches the hash fixed at creation, order re-derivable.
    const events = await db.select().from(productDrawEvents).where(eq(productDrawEvents.productId, d.productId));
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "entry")).toHaveLength(5);
    for (const k of ["created", "withdrawn", "closed", "charge_failed", "lost", "drawn"]) expect(kinds).toContain(k);
    expect(kinds.filter((k) => k === "winner")).toHaveLength(2);
    const created = events.find((e) => e.kind === "created")!;
    const drawn = events.find((e) => e.kind === "drawn")!;
    expect(seedHash(String(drawn.detail.seed))).toBe(created.detail.seedHash);
    expect(drawn.detail.order).toEqual(drawOrder(String(drawn.detail.seed), entered.map((e) => e.id)));

    // Results: in-app for everyone, push only for the buyer who asked.
    const feed = await db.select().from(notificationsFeed)
      .where(and(eq(notificationsFeed.targetId, d.productId), inArray(notificationsFeed.type, ["draw_won", "draw_lost"])));
    expect(feed).toHaveLength(4);
    const p1Entry = after.find((e) => e.buyerId === people[0].buyer)!;
    const drawPushes = pushes.filter((args) => ["draw_won", "draw_lost"].includes((args[1] as any)?.data?.type));
    const p1Pushed = drawPushes.filter((args) => args[0] === people[0].buyer).length;
    expect(drawPushes.length).toBe(p1Pushed);
    expect(p1Pushed).toBe(p1Entry.status === "withdrawn" ? 0 : 1);

    // My result.
    const mine = await api(`/api/product-draws/${d.productId}/entry`, byId.get(winners[0])!.buyerId);
    expect(mine.body.entry).toMatchObject({ status: "won", variantLabel: "M" });

    // Leftover (here: restocked) units sell normally once the draw has run.
    await db.update(productVariants).set({ stock: sql`${productVariants.stock} + 1` }).where(eq(productVariants.id, d.variantId));
    await expect(priceCartGroup({
      buyerId: people[4].buyer, items: [{ variantId: d.variantId, productId: d.productId, quantity: 1 }],
      shipping: { name: "x", street: "1 St", line2: null, city: "New York", state: "NY", zip: "10012", country: "US", phone: "" },
    })).resolves.toMatchObject({ sellerId: d.seller });

    // Seller sees the audit log; nobody else does.
    expect((await api(`/api/product-draws/${d.productId}/audit`, d.seller)).body.map((e: any) => e.kind)).toContain("drawn");
    expect((await api(`/api/product-draws/${d.productId}/audit`, people[0].buyer)).status).toBe(404);
  });

  it("seller cancel releases every hold and reopens normal checkout", async () => {
    const d = await seedDraw("cancel", 3);
    const a = await buyerWithAddress("cancel-a");
    const b = await buyerWithAddress("cancel-b");
    const ia = await enter(d.productId, d.variantId, a);
    const ib = await enter(d.productId, d.variantId, b);
    // Can't move the window once people entered.
    expect((await api(`/api/product-draws/${d.productId}`, d.seller, "PUT", { entryClosesAt: new Date(Date.now() + 120 * MIN).toISOString() })).body.code).toBe("HAS_ENTRIES");
    expect((await api(`/api/product-draws/${d.productId}`, d.seller, "DELETE")).body).toEqual({ cancelled: true });
    expect(fake.state.paymentIntents.get(ia).status).toBe("canceled");
    expect(fake.state.paymentIntents.get(ib).status).toBe("canceled");
    const rows = await db.select({ status: productDrawEntries.status }).from(productDrawEntries).where(eq(productDrawEntries.productId, d.productId));
    expect(rows.every((r) => r.status === "released")).toBe(true);
    expect((await api(`/api/product-draws/${d.productId}`, undefined)).body.draw).toBeNull();
    expect(await runProductDraws(fake.stripe as any, new Date(d.closesAt.getTime() + 1000))).toEqual({ drawn: 0 });
  });

  it("entries outside the window and with the flag off are refused", async () => {
    const d = await seedDraw("window", 1);
    const a = await buyerWithAddress("window-a");
    await db.update(productDraws).set({ entryClosesAt: new Date(Date.now() - 1000) }).where(eq(productDraws.productId, d.productId));
    expect((await api(`/api/product-draws/${d.productId}/entry`, a.buyer, "POST", { variantId: d.variantId, addressId: a.addressId })).body.code).toBe("DRAW_NOT_OPEN");

    await setFlag(false);
    try {
      expect((await api(`/api/product-draws/${d.productId}/entry`, a.buyer, "POST", { variantId: d.variantId, addressId: a.addressId })).status).toBe(404);
      const seller2 = await seedSeller("flag");
      const p2 = await seedProduct(seller2, { priceCents: 1000, stock: 1 });
      await db.insert(productLaunches).values({ productId: p2.productId, launchAt: new Date(Date.now() + 60 * MIN) });
      expect((await api(`/api/product-draws/${p2.productId}`, seller2, "PUT", { entryClosesAt: new Date(Date.now() + 120 * MIN).toISOString() })).status).toBe(403);
    } finally {
      await setFlag(true);
    }
    // Someone else's address can't be used.
    const other = await buyerWithAddress("window-other");
    await db.update(productDraws).set({ entryClosesAt: new Date(Date.now() + 60 * MIN) }).where(eq(productDraws.productId, d.productId));
    expect((await api(`/api/product-draws/${d.productId}/entry`, a.buyer, "POST", { variantId: d.variantId, addressId: other.addressId })).body.code).toBe("ADDRESS_REQUIRED");
    void uid;
  });
});
