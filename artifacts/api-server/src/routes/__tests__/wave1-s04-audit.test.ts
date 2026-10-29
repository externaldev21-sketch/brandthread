/**
 * Wave 1 audit (slice s04) regressions, against the real routes + test DB:
 *  - malformed uuid path ids are 404s, not Postgres 500s (disputes,
 *    drop-wallets, drops, featured-slots);
 *  - dispute evidence with a non-string description is a 400, not a 500;
 *  - drops: invalid dates are 400s (not Invalid Date 500s), `endsAt: null`
 *    clears the end time, and PATCH keeps endsAt after releaseAt;
 *  - discount validate: malformed `items` JSON lines can't 500 or price NaN;
 *    the uses ledger is capped / pageable;
 *  - email campaigns list: stats come from one grouped query, not one per row;
 *  - followed-fresh: deleted / draft tagged products are not shown.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray, like, or } from "drizzle-orm";
import {
  db, discountCodes, discountCodeUses, disputes, drops, emailCampaigns, emailCampaignSends, follows,
  postTaggedProducts, posts, products, users,
} from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.headers["x-test-user"];
    if (typeof user !== "string" || !user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
  requireModerator: (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../middlewares/requireRole", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireRole")>();
  return {
    ...actual,
    requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
    requireRole: () => (_req: any, _res: any, next: () => void) => next(),
  };
});

const sfx = crypto.randomBytes(5).toString("hex");
const id = (name: string) => `w1s04-${sfx}-${name}`;
const SELLER = id("seller");
const BUYER = id("buyer");
const BAD_ID = "not-a-uuid";

let server: Server;
let base = "";

async function call(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": opts.user ?? SELLER },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@test.local`, name: "Seller", displayName: "Seller", brandName: "Brand", role: "seller", accountType: "seller", onboardingComplete: true },
    { clerkId: BUYER, email: `${BUYER}@test.local`, name: "Buyer", displayName: "Buyer", role: "buyer", accountType: "buyer", onboardingComplete: true },
  ]);
  const [discountRouter, disputesRouter, walletRouter, dropsRouter, featuredRouter, emailRouter, freshRouter] = await Promise.all([
    import("../discount-codes"), import("../disputes"), import("../drop-wallet"), import("../drops"),
    import("../featured-slots"), import("../email-marketing"), import("../feed-followed-fresh"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} };
    next();
  });
  app.use("/api/discount-codes", discountRouter.default);
  app.use("/api/disputes", disputesRouter.default);
  app.use("/api/drop-wallets", walletRouter.default);
  app.use("/api/drops", dropsRouter.default);
  app.use("/api/featured-slots", featuredRouter.default);
  app.use("/api/marketing/email", emailRouter.default);
  app.use("/api/feed", freshRouter.default);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(discountCodeUses).where(like(discountCodeUses.sellerId, `w1s04-${sfx}-%`));
  await db.delete(discountCodes).where(like(discountCodes.sellerId, `w1s04-${sfx}-%`));
  await db.delete(disputes).where(like(disputes.sellerId, `w1s04-${sfx}-%`));
  await db.delete(drops).where(like(drops.ownerId, `w1s04-${sfx}-%`));
  await db.delete(emailCampaignSends).where(like(emailCampaignSends.sellerId, `w1s04-${sfx}-%`));
  await db.delete(emailCampaigns).where(like(emailCampaigns.sellerId, `w1s04-${sfx}-%`));
  await db.delete(posts).where(like(posts.userId, `w1s04-${sfx}-%`));
  await db.delete(products).where(like(products.ownerId, `w1s04-${sfx}-%`));
  await db.delete(follows).where(or(like(follows.followerId, `w1s04-${sfx}-%`), like(follows.followingId, `w1s04-${sfx}-%`)));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, BUYER]));
});

describe("malformed uuid path ids are 404, not 500", () => {
  it.each([
    ["GET", `/api/disputes/${BAD_ID}`],
    ["GET", `/api/disputes/${BAD_ID}/timeline`],
    ["POST", `/api/disputes/${BAD_ID}/evidence`],
    ["POST", `/api/disputes/${BAD_ID}/submit`],
    ["POST", `/api/disputes/${BAD_ID}/accept`],
    ["GET", `/api/drop-wallets/${BAD_ID}`],
    ["POST", `/api/drop-wallets/${BAD_ID}`],
    ["POST", `/api/drop-wallets/${crypto.randomUUID()}/release-order/${BAD_ID}`],
    ["GET", `/api/drops/${BAD_ID}`],
    ["PATCH", `/api/drops/${BAD_ID}`],
    ["GET", `/api/drops/${BAD_ID}/broadcast-preview`],
    ["GET", `/api/drops/${BAD_ID}/sms-blast`],
    ["POST", `/api/drops/${BAD_ID}/cancel`],
    ["POST", `/api/featured-slots/${BAD_ID}/cancel`],
    ["POST", `/api/featured-slots/${BAD_ID}/pay/verify`],
  ])("%s %s", async (method, path) => {
    const r = await call(method, path, { body: method === "GET" ? undefined : {} });
    expect(r.status).toBe(404);
  });
});

describe("dispute evidence body validation", () => {
  it("rejects a non-string description with a 400 instead of throwing", async () => {
    const [d] = await db.insert(disputes).values({
      sellerId: SELLER, stripeDisputeId: `dp_${sfx}_${crypto.randomUUID()}`, amountCents: 500,
    }).returning();
    const numeric = await call("POST", `/api/disputes/${d.id}/evidence`, { body: { type: "written_response", description: 42 } });
    expect(numeric.status).toBe(400);
    const tooLong = await call("POST", `/api/disputes/${d.id}/evidence`, {
      body: { type: "written_response", description: "x".repeat(20_001) },
    });
    expect(tooLong.status).toBe(400);
    const ok = await call("POST", `/api/disputes/${d.id}/evidence`, { body: { type: "written_response", description: "Delivered on time" } });
    expect(ok.status).toBe(200);
    expect(ok.body.evidenceItem.description).toBe("Delivered on time");
  });
});

describe("drops date handling", () => {
  it("rejects an unparseable estimatedPayoutDate on create", async () => {
    const r = await call("POST", "/api/drops", { body: { name: "Bad payout", type: "pre-made", estimatedPayoutDate: "soon" } });
    expect(r.status).toBe(400);
  });

  it("rejects an unparseable estimatedShipDate on PATCH", async () => {
    const created = await call("POST", "/api/drops", { body: { name: "Ship", type: "pre-made" } });
    expect(created.status).toBe(201);
    const r = await call("PATCH", `/api/drops/${created.body.id}`, { body: { estimatedShipDate: "next week" } });
    expect(r.status).toBe(400);
  });

  it("clears endsAt when the app sends endsAt: null, and keeps the end after the release", async () => {
    const releaseAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const endsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const created = await call("POST", "/api/drops", { body: { name: "Window", type: "pre-made", releaseAt, endsAt } });
    expect(created.status).toBe(201);
    expect(created.body.endsAt).not.toBeNull();

    // Moving the release past the stored end, without changing the end, is refused.
    const later = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const bad = await call("PATCH", `/api/drops/${created.body.id}`, { body: { releaseAt: later } });
    expect(bad.status).toBe(400);

    // The app's "Set an end time" turned off: release moves, end is cleared.
    const cleared = await call("PATCH", `/api/drops/${created.body.id}`, { body: { releaseAt: later, endsAt: null } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.endsAt).toBeNull();
    expect(new Date(cleared.body.releaseAt).toISOString()).toBe(later);
  });
});

describe("discount code validate + uses", () => {
  it("ignores malformed item lines instead of 500ing or pricing NaN", async () => {
    const created = await call("POST", "/api/discount-codes", { body: { code: `W1${sfx}`, type: "percentage", value: 10 } });
    expect(created.status).toBe(201);
    const items = encodeURIComponent(JSON.stringify([null, { productId: "p1", priceCents: "abc", quantity: 1 }, { productId: "p2", priceCents: 4000, quantity: 1 }]));
    const r = await call("GET", `/api/discount-codes/validate?code=W1${sfx}&sellerId=${encodeURIComponent(SELLER)}&subtotalCents=4000&items=${items}`, { user: BUYER });
    expect(r.status).toBe(200);
    expect(r.body.appliedAmountCents).toBe(400);

    const inf = await call("GET", `/api/discount-codes/validate?code=W1${sfx}&sellerId=${encodeURIComponent(SELLER)}&subtotalCents=Infinity`, { user: BUYER });
    expect(inf.status).toBe(400);
  });

  it("pages the redemption ledger", async () => {
    const created = await call("POST", "/api/discount-codes", { body: { code: `W1L${sfx}`, type: "fixed", value: 5 } });
    expect(created.status).toBe(201);
    await db.insert(discountCodeUses).values([1, 2, 3].map((n) => ({
      discountCodeId: created.body.id, sellerId: SELLER, customerKey: `guest:g${n}@test.local`,
      orderId: crypto.randomUUID(), appliedAmountCents: 500,
    })));
    const r = await call("GET", `/api/discount-codes/${created.body.id}/uses?limit=2`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    expect(r.headers.get("x-pagination-has-more")).toBe("true");
    const all = await call("GET", `/api/discount-codes/${created.body.id}/uses`);
    expect(all.body).toHaveLength(3);
  });
});

describe("email campaigns list", () => {
  it("returns per-campaign stats from one grouped query", async () => {
    const [a, b, empty, draft] = await db.insert(emailCampaigns).values([
      { sellerId: SELLER, subject: "A", status: "sent" },
      { sellerId: SELLER, subject: "B", status: "sent" },
      { sellerId: SELLER, subject: "C", status: "sent" },
      { sellerId: SELLER, subject: "D", status: "draft" },
    ]).returning();
    const sub = () => crypto.randomUUID();
    await db.insert(emailCampaignSends).values([
      { campaignId: a.id, sellerId: SELLER, subscriberId: sub(), email: "1@t.local", status: "sent", openedAt: new Date() },
      { campaignId: a.id, sellerId: SELLER, subscriberId: sub(), email: "2@t.local", status: "failed" },
      { campaignId: b.id, sellerId: SELLER, subscriberId: sub(), email: "3@t.local", status: "sent", deliveredAt: new Date() },
    ]);
    const spy = vi.spyOn(db, "execute");
    try {
      const r = await call("GET", "/api/marketing/email/campaigns");
      expect(r.status).toBe(200);
      // One grouped stats query for the whole page (was one per campaign).
      expect(spy).toHaveBeenCalledTimes(1);
      const byId = new Map<string, any>(r.body.campaigns.map((c: any) => [c.id, c]));
      expect(byId.get(a.id).stats).toMatchObject({ sent: 1, failed: 1, opened: 1, delivered: 0 });
      expect(byId.get(b.id).stats).toMatchObject({ sent: 1, failed: 0, delivered: 1 });
      expect(byId.get(empty.id).stats).toEqual({ sent: 0, failed: 0, skipped: 0, queued: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 });
      expect(byId.get(draft.id).stats).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("followed-fresh tagged products", () => {
  it("drops deleted and draft tagged products, keeps active ones", async () => {
    await db.insert(follows).values({ followerId: BUYER, followingId: SELLER });
    const [post] = await db.insert(posts).values({
      userId: SELLER, mediaUrl: `https://cdn.example.test/${sfx}.jpg`, mediaType: "photo", caption: "new",
      surface: "thread", postStatus: "published", moderationStatus: "visible",
      visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true },
    }).returning({ id: posts.id });
    const [active, draft, deleted] = await db.insert(products).values([
      { ownerId: SELLER, name: "Active tee", status: "active" },
      { ownerId: SELLER, name: "Draft tee", status: "draft" },
      { ownerId: SELLER, name: "Deleted tee", status: "active", deletedAt: new Date() },
    ]).returning({ id: products.id });
    await db.insert(postTaggedProducts).values([
      { postId: post.id, productId: active.id, position: 0 },
      { postId: post.id, productId: draft.id, position: 1 },
      { postId: post.id, productId: deleted.id, position: 2 },
    ]);
    const r = await call("GET", "/api/feed/followed-fresh", { user: BUYER });
    expect(r.status).toBe(200);
    const item = r.body.find((p: any) => p.id === post.id);
    expect(item).toBeTruthy();
    expect(item.taggedProducts.map((t: any) => t.productId)).toEqual([active.id]);
  });
});
