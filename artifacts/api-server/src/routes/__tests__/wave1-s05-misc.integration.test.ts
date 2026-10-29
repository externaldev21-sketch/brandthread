/**
 * Wave-1 audit (slice s05) fixes, against the real routers + test database:
 *  - giveaways: PATCH can't move dates into another open giveaway's period;
 *    /rules-template survives a repeated query key.
 *  - gift-cards: a non-uuid card id is a 404, not a Postgres 500.
 *  - freelancers: suspended/deleted accounts aren't listed; out-of-int rate
 *    bounds don't 500.
 *  - freelancer-connect: onboarding URLs must be Brandthread https origins;
 *    account creation carries an idempotency key.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray, like } from "drizzle-orm";
import { db, freelancers, giveaways, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = req.header("x-test-user-id"); next(); },
}));
vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.header("x-test-user-id") || null }),
}));
vi.mock("../../middlewares/requireRole", () => ({
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: () => void) => next(),
}));
const fakeStripe = vi.hoisted(() => {
  const accountCreates: any[] = [];
  const linkCreates: any[] = [];
  return {
    accountCreates, linkCreates,
    client: {
      accounts: { create: async (params: any, options: any) => { accountCreates.push({ params, options }); return { id: `acct_s05_${accountCreates.length}` }; } },
      accountLinks: { create: async (params: any) => { linkCreates.push(params); return { url: "https://connect.stripe.test/onboard" }; } },
    },
  };
});
vi.mock("../../lib/stripe", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/stripe")>();
  return { ...real, requireStripe: () => fakeStripe.client };
});

const sfx = crypto.randomBytes(5).toString("hex");
const id = (n: string) => `s05-${sfx}-${n}`;
const SELLER = id("seller");
const FL_OK = id("fl-ok");
const FL_SUSP = id("fl-susp");
const FL_DEL = id("fl-del");
const FL_CONNECT = id("fl-connect");
const everyone = [SELLER, FL_OK, FL_SUSP, FL_DEL, FL_CONNECT];
let server: Server;
let base = "";

async function call(method: string, path: string, as: string | null, body?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(as ? { "x-test-user-id": as } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const DAY = 86_400_000;

beforeAll(async () => {
  await db.insert(users).values(everyone.map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId, displayName: clerkId, role: "seller",
    accountType: "seller", ageBand: "18_plus",
    ...(clerkId === FL_SUSP ? { suspendedAt: new Date() } : {}),
    ...(clerkId === FL_DEL ? { deletedAt: new Date() } : {}),
  })));
  // A distinctive rate so the listing query can be narrowed to these rows.
  const rate = 7_777_77;
  await db.insert(freelancers).values([FL_OK, FL_SUSP, FL_DEL, FL_CONNECT].map((userId) => ({
    userId, serviceType: "branding", hourlyRateCents: rate,
  })));

  const { sellerGiveawaysRouter } = await import("../giveaways");
  const { default: giftCardsRouter } = await import("../gift-cards");
  const { default: freelancersRouter } = await import("../freelancers");
  const { default: freelancerConnectRouter } = await import("../freelancer-connect");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }; next(); });
  app.use("/api/seller/giveaways", sellerGiveawaysRouter);
  app.use("/api/gift-cards", giftCardsRouter);
  app.use("/api/freelancers/connect", freelancerConnectRouter);
  app.use("/api/freelancers", freelancersRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(giveaways).where(like(giveaways.sellerId, `s05-${sfx}-%`));
  await db.delete(freelancers).where(inArray(freelancers.userId, everyone));
  await db.delete(users).where(inArray(users.clerkId, everyone));
});

describe("giveaways", () => {
  const input = (startMs: number, endMs: number, title: string) => ({
    title, prizeText: "A jacket", rulesText: "NO PURCHASE NECESSARY", startsAt: iso(startMs), endsAt: iso(endMs), winnerCount: 1,
  });

  it("PATCH refuses to move a giveaway into another open one's period", async () => {
    const a = await call("POST", "/api/seller/giveaways", SELLER, input(1 * DAY, 3 * DAY, "First"));
    const b = await call("POST", "/api/seller/giveaways", SELLER, input(5 * DAY, 7 * DAY, "Second"));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const moved = await call("PATCH", `/api/seller/giveaways/${b.body.id}`, SELLER, { startsAt: iso(2 * DAY), endsAt: iso(6 * DAY) });
    expect(moved.status).toBe(409);
    expect(moved.body.code).toBe("GIVEAWAY_OVERLAP");
    // Editing its own dates without overlapping still works.
    const ok = await call("PATCH", `/api/seller/giveaways/${b.body.id}`, SELLER, { startsAt: iso(4 * DAY), endsAt: iso(8 * DAY) });
    expect(ok.status).toBe(200);
  });

  it("rules-template ignores a repeated query key instead of 500ing", async () => {
    const r = await call("GET", "/api/seller/giveaways/rules-template?prizeText=a&prizeText=b&region=x&region=y", SELLER);
    expect(r.status).toBe(200);
    expect(r.body.rulesText).toContain("the prize described above");
  });
});

describe("gift cards", () => {
  it("answers 404 for a non-uuid card id", async () => {
    expect((await call("GET", "/api/gift-cards/mine/not-a-uuid", SELLER)).status).toBe(404);
    expect((await call("POST", "/api/gift-cards/seller/cards/not-a-uuid/void", SELLER)).status).toBe(404);
    expect((await call("POST", "/api/gift-cards/purchase/not-a-uuid/confirm", SELLER)).status).toBe(404);
  });
});

describe("freelancers list", () => {
  it("hides suspended and deleted accounts", async () => {
    const r = await call("GET", "/api/freelancers?minRate=777777&maxRate=777777", null);
    expect(r.status).toBe(200);
    const ids = r.body.freelancers.map((f: any) => f.userId);
    expect(ids).toContain(FL_OK);
    expect(ids).not.toContain(FL_SUSP);
    expect(ids).not.toContain(FL_DEL);
  });

  it("does not 500 on a rate bound outside int4", async () => {
    const r = await call("GET", "/api/freelancers?minRate=99999999999999999999", null);
    expect(r.status).toBe(200);
  });
});

describe("freelancer connect onboarding", () => {
  it("rejects a non-Brandthread return URL", async () => {
    const r = await call("POST", "/api/freelancers/connect/onboard", FL_CONNECT, { returnUrl: "https://evil.example/phish" });
    expect(r.status).toBe(400);
    expect(fakeStripe.linkCreates).toHaveLength(0);
  });

  it("creates the Express account with an idempotency key", async () => {
    const r = await call("POST", "/api/freelancers/connect/onboard", FL_CONNECT, {});
    expect(r.status).toBe(200);
    expect(fakeStripe.accountCreates.at(-1)?.options).toEqual({ idempotencyKey: `freelancer-connect-express-${FL_CONNECT}` });
  });
});
