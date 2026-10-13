import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, discountCodes, discountCodeUses, users } from "@workspace/db";
import { recordDiscountCodeUse, validateDiscountCode, DiscountValidationError } from "../../lib/discounts";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));

const sfx = crypto.randomBytes(5).toString("hex");
const id = (name: string) => `dcx-${sfx}-${name}`;
const SELLER = id("seller");
const OTHER_SELLER = id("other");
const BUYER = id("buyer");
const BUYER2 = id("buyer2");

let server: Server;
let base = "";

async function call(method: string, path: string, as: string, body?: unknown) {
  const r = await fetch(`${base}/api/discount-codes${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user-id": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() as any };
}

const validate = (code: string, as: string, subtotalCents = 5000) =>
  call("GET", `/validate?code=${encodeURIComponent(code)}&sellerId=${encodeURIComponent(SELLER)}&subtotalCents=${subtotalCents}`, as);

async function redeem(codeId: string, customerKey: string) {
  await recordDiscountCodeUse(db, {
    discountCodeId: codeId, sellerId: SELLER, customerKey, orderId: crypto.randomUUID(), appliedAmountCents: 500,
  });
}

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
const HOUR = 3_600_000;

beforeAll(async () => {
  await db.insert(users).values([SELLER, OTHER_SELLER, BUYER, BUYER2].map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId === BUYER ? "Ada Buyer" : clerkId,
    role: "buyer", accountType: clerkId === SELLER || clerkId === OTHER_SELLER ? "seller" : "buyer",
  })));
  const { default: router } = await import("../discount-codes");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: () => {}, info: () => {}, warn: () => {} }; next(); });
  app.use("/api/discount-codes", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(discountCodeUses).where(like(discountCodeUses.sellerId, `dcx-${sfx}-%`));
  await db.delete(discountCodes).where(like(discountCodes.sellerId, `dcx-${sfx}-%`));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, OTHER_SELLER, BUYER, BUYER2]));
});

describe("discount codes: limits and active dates", () => {
  it("creates a code with total + per-customer limits, a start/end time and the seller's time zone", async () => {
    const startsAt = iso(-HOUR);
    const expiresAt = iso(48 * HOUR);
    const r = await call("POST", "/", SELLER, {
      code: "limit3", type: "percentage", value: 10, maxUses: 3, maxUsesPerCustomer: 2,
      startsAt, expiresAt, scheduleTimeZone: "America/New_York",
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      code: "LIMIT3", maxUses: 3, maxUsesPerCustomer: 2, scheduleTimeZone: "America/New_York", status: "active",
    });
    expect(new Date(r.body.startsAt).toISOString()).toBe(startsAt);
    expect(new Date(r.body.expiresAt).toISOString()).toBe(expiresAt);
  });

  it("keeps minute precision on the stored instants (not just the date)", async () => {
    const startsAt = "2031-03-09T14:30:00.000Z";
    const r = await call("POST", "/", SELLER, { code: "MINUTE", type: "fixed", value: 5, startsAt });
    expect(r.status).toBe(201);
    const [row] = await db.select().from(discountCodes).where(eq(discountCodes.id, r.body.id));
    expect(row!.startsAt!.toISOString()).toBe(startsAt);
    expect(r.body.status).toBe("scheduled");
  });

  it("rejects bad dates, an end before the start, a bad time zone and a zero limit with 400s", async () => {
    const bad = [
      { startsAt: "not a date" },
      { expiresAt: "2026-13-45" },
      { startsAt: iso(2 * HOUR), expiresAt: iso(HOUR) },
      { startsAt: iso(HOUR), expiresAt: iso(HOUR) },
      { scheduleTimeZone: "Mars/Olympus_Mons" },
      { maxUses: 0 },
      { maxUsesPerCustomer: 0 },
    ];
    for (const extra of bad) {
      const r = await call("POST", "/", SELLER, { type: "percentage", value: 10, ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
  });

  it("checks the end stays after the start when only one side is edited", async () => {
    const created = await call("POST", "/", SELLER, { code: "EDITWIN", type: "percentage", value: 10, startsAt: iso(HOUR), expiresAt: iso(5 * HOUR) });
    expect(created.status).toBe(201);
    const tooEarly = await call("PATCH", `/${created.body.id}`, SELLER, { expiresAt: iso(30 * 60_000) });
    expect(tooEarly.status).toBe(400);
    const ok = await call("PATCH", `/${created.body.id}`, SELLER, { expiresAt: iso(6 * HOUR), scheduleTimeZone: "Asia/Kolkata" });
    expect(ok.status).toBe(200);
    expect(ok.body.scheduleTimeZone).toBe("Asia/Kolkata");
    const other = await call("PATCH", `/${created.body.id}`, OTHER_SELLER, { expiresAt: iso(7 * HOUR) });
    expect(other.status).toBe(404);
  });

  it("rejects a code that starts in the future, then accepts it once the start moves to now", async () => {
    const created = await call("POST", "/", SELLER, { code: "LATER", type: "percentage", value: 15, startsAt: iso(HOUR) });
    expect(created.body.status).toBe("scheduled");
    const early = await validate("LATER", BUYER);
    expect(early.status).toBe(400);
    expect(early.body.error).toBe("NOT_STARTED");
    await call("PATCH", `/${created.body.id}`, SELLER, { startsAt: iso(-60_000) });
    const now = await validate("later", BUYER);
    expect(now.status).toBe(200);
    expect(now.body.appliedAmountCents).toBe(750);
  });

  it("rejects an expired code", async () => {
    const created = await call("POST", "/", SELLER, { code: "GONE", type: "percentage", value: 10, startsAt: iso(-2 * HOUR), expiresAt: iso(-60_000) });
    expect(created.body.status).toBe("expired");
    const r = await validate("GONE", BUYER);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("EXPIRED");
  });

  it("is valid from the start instant and expired from the end instant (boundaries)", async () => {
    const startsAt = new Date("2031-01-01T05:00:00.000Z");
    const expiresAt = new Date("2031-01-02T05:00:00.000Z");
    await call("POST", "/", SELLER, { code: "EDGE", type: "percentage", value: 10, startsAt: startsAt.toISOString(), expiresAt: expiresAt.toISOString() });
    const run = (now: Date) => validateDiscountCode({
      sellerId: SELLER, code: "EDGE", customerKey: BUYER, cartSubtotalCents: 1000,
      lines: [{ productId: "*", priceCents: 1000, quantity: 1 }], now,
    });
    await expect(run(new Date(startsAt.getTime() - 1))).rejects.toMatchObject({ code: "NOT_STARTED" });
    await expect(run(startsAt)).resolves.toMatchObject({ appliedAmountCents: 100 });
    await expect(run(new Date(expiresAt.getTime() - 1))).resolves.toMatchObject({ appliedAmountCents: 100 });
    await expect(run(expiresAt)).rejects.toBeInstanceOf(DiscountValidationError);
    await expect(run(expiresAt)).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("rejects a code once its total limit is used up", async () => {
    const created = await call("POST", "/", SELLER, { code: "TWOTOTAL", type: "fixed", value: 5, maxUses: 2 });
    await redeem(created.body.id, BUYER);
    expect((await validate("TWOTOTAL", BUYER2)).status).toBe(200);
    await redeem(created.body.id, BUYER2);
    const r = await validate("TWOTOTAL", id("fresh"));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("MAX_USES_REACHED");
    const list = await call("GET", "/", SELLER);
    expect(list.body.find((c: any) => c.id === created.body.id)).toMatchObject({ usesCount: 2, status: "exhausted" });
  });

  it("enforces a per-customer limit above one, per customer", async () => {
    const created = await call("POST", "/", SELLER, { code: "TWOEACH", type: "percentage", value: 20, maxUsesPerCustomer: 2 });
    await redeem(created.body.id, BUYER);
    expect((await validate("TWOEACH", BUYER)).status).toBe(200);
    await redeem(created.body.id, BUYER);
    const third = await validate("TWOEACH", BUYER);
    expect(third.status).toBe(400);
    expect(third.body.error).toBe("CUSTOMER_LIMIT_REACHED");
    expect((await validate("TWOEACH", BUYER2)).status).toBe(200);
  });

  it("still honours the legacy one-use-per-customer flag", async () => {
    const created = await call("POST", "/", SELLER, { code: "ONCE", type: "percentage", value: 20, oneUsePerCustomer: true });
    await redeem(created.body.id, BUYER);
    const again = await validate("ONCE", BUYER);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("ALREADY_USED_BY_CUSTOMER");
  });

  it("clears the per-customer limit when edited back to null", async () => {
    const created = await call("POST", "/", SELLER, { code: "CLEARME", type: "percentage", value: 20, maxUsesPerCustomer: 1 });
    await redeem(created.body.id, BUYER);
    expect((await validate("CLEARME", BUYER)).body.error).toBe("CUSTOMER_LIMIT_REACHED");
    const r = await call("PATCH", `/${created.body.id}`, SELLER, { maxUsesPerCustomer: null, oneUsePerCustomer: false });
    expect(r.status).toBe(200);
    expect(r.body.maxUsesPerCustomer).toBeNull();
    expect((await validate("CLEARME", BUYER)).status).toBe(200);
  });

  it("lists a code's redemptions newest first with who redeemed it, to its seller only", async () => {
    const created = await call("POST", "/", SELLER, { code: "LEDGER", type: "fixed", value: 5 });
    await redeem(created.body.id, BUYER);
    await new Promise((r) => setTimeout(r, 15));
    await redeem(created.body.id, "guest:shopper@example.test");
    const r = await call("GET", `/${created.body.id}/uses`, SELLER);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    expect(r.body[0]).toMatchObject({ customerKey: "guest:shopper@example.test", customerName: "shopper@example.test", appliedAmountCents: 500 });
    expect(r.body[1]).toMatchObject({ customerKey: BUYER, customerName: "Ada Buyer" });
    expect((await call("GET", `/${created.body.id}/uses`, OTHER_SELLER)).status).toBe(404);
  });
});
