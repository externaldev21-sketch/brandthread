/**
 * Admin dashboard API, real DB + real Express routers. Covers the admin gate,
 * user moderation (suspend / reinstate / verify, never delete), the audit log
 * (written in the same transaction, append-only), revenue aggregation,
 * featured-on-Discover, announcements fan-out, invite-code redemption limits,
 * promoted-thread approvals and AI spend metering.
 *
 * `requireAuth` reads the caller off a header (same substitution the other
 * integration tests here use); Clerk's ban API and push are recorded.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { randomUUID } from "node:crypto";
import { eq, inArray, like, sql } from "drizzle-orm";
import {
  db, users, orders, boosts, posts, adminAuditLog, adminInviteCodes, adminAnnouncements,
  featuredItems, notificationsFeed, aiUsageEvents, boostReviews, adminInviteCodeUses,
} from "@workspace/db";

vi.hoisted(() => {
  // The OpenAI client (loaded by the AI-usage hook) refuses to import without these.
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-key";
});

const clerkCalls: string[] = [];
const pushes: string[] = [];

vi.mock("../../middlewares/requireAuth", async (orig) => ({
  ...(await orig<typeof import("../../middlewares/requireAuth")>()),
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
}));
vi.mock("@clerk/express", async (orig) => ({
  ...(await orig<typeof import("@clerk/express")>()),
  clerkClient: {
    users: {
      banUser: async (id: string) => { clerkCalls.push(`ban:${id}`); },
      unbanUser: async (id: string) => { clerkCalls.push(`unban:${id}`); },
    },
  },
}));
vi.mock("../../lib/push", async (orig) => ({
  ...(await orig<typeof import("../../lib/push")>()),
  sendPushToUser: async (userId: string) => { pushes.push(userId); return true; },
}));

import adminRouter from "../admin";
import featuredPublicRouter from "../featured-public";
import referralsRouter from "../referrals";
import { deliverAnnouncement } from "../../lib/admin/announcements";
import { recordAiUsage } from "../../lib/aiUsage";
import { priceAiUsage } from "../../lib/admin/aiPricing";

const P = `adm${process.pid}`;
const U = (n: string) => `${P}-${n}`;
const ADMIN = U("admin"), SELLER = U("seller"), BUYER = U("buyer"), OTHER_ADMIN = U("admin2"), FAN = U("fan");

let server: Server;
let base = "";

type Res = Omit<Response, "json"> & { json(): Promise<any> };
function call(user: string | null, path: string, init: RequestInit = {}): Promise<Res> {
  return fetch(`${base}/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(user ? { "x-test-acting-as": user } : {}) },
  });
}
const get = (u: string | null, p: string) => call(u, p);
const post = (u: string | null, p: string, body?: unknown) => call(u, p, { method: "POST", body: JSON.stringify(body ?? {}) });
const patch = (u: string | null, p: string, body?: unknown) => call(u, p, { method: "PATCH", body: JSON.stringify(body ?? {}) });
const del = (u: string | null, p: string) => call(u, p, { method: "DELETE" });

async function auditFor(targetId: string) {
  return db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, targetId));
}

let postId = "";
let boostId = "";

beforeAll(async () => {
  const mk = (clerkId: string, extra: Partial<typeof users.$inferInsert> = {}) => ({
    clerkId, email: `${clerkId}@example.test`, name: clerkId, ...extra,
  });
  await db.insert(users).values([
    mk(ADMIN, { role: "admin" }),
    mk(OTHER_ADMIN, { role: "admin" }),
    mk(SELLER, { role: "owner", accountType: "seller", brandName: "Acme Threads", username: `${P}acme` }),
    mk(BUYER, { role: "buyer", accountType: "buyer" }),
    mk(FAN, { role: "buyer", accountType: "buyer" }),
  ]);
  const [post] = await db.insert(posts).values({ userId: SELLER, mediaUrl: "https://example.test/a.jpg", caption: "Spring drop" }).returning();
  postId = post!.id;
  const [boost] = await db.insert(boosts).values({
    sellerId: SELLER, targetType: "post", targetId: postId, budgetCents: 2500, status: "active",
    paidAt: new Date(), endsAt: new Date(Date.now() + 7 * 86_400_000),
  }).returning();
  boostId = boost!.id;
  await db.insert(orders).values([
    { ownerId: SELLER, buyerId: BUYER, orderNumber: `${P}-1`, totalCents: 10_000, subtotalCents: 9_000, platformFeeCents: 500, paidAt: new Date(), status: "shipped" },
    { ownerId: SELLER, buyerId: BUYER, orderNumber: `${P}-2`, totalCents: 4_000, subtotalCents: 4_000, platformFeeCents: 200, platformFeeRefundedCents: 200, refundedCents: 4_000, paidAt: new Date(), status: "cancelled" },
  ]);

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error() {}, warn() {}, info() {} }; next(); });
  app.use("/api/public/featured", featuredPublicRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/referrals", referralsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(orders).where(like(orders.orderNumber, `${P}-%`));
  await db.delete(boosts).where(eq(boosts.sellerId, SELLER));
  await db.delete(posts).where(eq(posts.userId, SELLER));
  await db.delete(featuredItems).where(like(featuredItems.createdBy, `${P}-%`));
  await db.delete(notificationsFeed).where(like(notificationsFeed.userId, `${P}-%`));
  await db.delete(adminAnnouncements).where(like(adminAnnouncements.createdBy, `${P}-%`));
  await db.delete(adminInviteCodeUses).where(like(adminInviteCodeUses.userId, `${P}-%`));
  await db.delete(adminInviteCodes).where(like(adminInviteCodes.createdBy, `${P}-%`));
  await db.delete(aiUsageEvents).where(like(aiUsageEvents.userId, `${P}-%`));
  await db.delete(users).where(like(users.clerkId, `${P}-%`));
});

describe("admin gate", () => {
  it("rejects signed-out, non-admin and suspended-admin callers on every admin route", async () => {
    expect((await get(null, "/admin/overview")).status).toBe(401);
    expect((await get(SELLER, "/admin/overview")).status).toBe(403);
    expect((await get(BUYER, "/admin/users")).status).toBe(403);
    expect((await post(SELLER, "/admin/announcements", { title: "x", body: "y", audience: "all" })).status).toBe(403);
    expect((await get(ADMIN, "/admin/overview")).status).toBe(200);

    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.clerkId, OTHER_ADMIN));
    expect((await get(OTHER_ADMIN, "/admin/overview")).status).toBe(403);
    await db.update(users).set({ suspendedAt: null }).where(eq(users.clerkId, OTHER_ADMIN));
  });

  it("/me tells any signed-in user whether they are an admin, and nothing else", async () => {
    expect(await (await get(ADMIN, "/admin/me")).json()).toMatchObject({ isAdmin: true });
    expect(await (await get(SELLER, "/admin/me")).json()).toEqual({ isAdmin: false });
  });
});

describe("users", () => {
  it("searches literally (wildcards are escaped) and filters", async () => {
    const hit = await (await get(ADMIN, `/admin/users?q=${encodeURIComponent("Acme Thr")}`)).json();
    expect(hit.items.map((u: any) => u.clerkId)).toContain(SELLER);
    const wild = await (await get(ADMIN, `/admin/users?q=${encodeURIComponent("%")}`)).json();
    expect(wild.items).toHaveLength(0);
    const sellers = await (await get(ADMIN, `/admin/users?kind=sellers&q=${P}`)).json();
    expect(sellers.items.map((u: any) => u.clerkId)).toEqual([SELLER]);
    expect((await get(ADMIN, "/admin/users?kind=bogus")).status).toBe(400);
  });

  it("returns a detail view with sales and AI spend", async () => {
    await db.insert(aiUsageEvents).values({ userId: SELLER, feature: "chat", model: "gpt-4.1", inputTokens: 1000, outputTokens: 500, costMicros: 6000 });
    const detail = await (await get(ADMIN, `/admin/users/${SELLER}`)).json();
    expect(detail.sales).toMatchObject({ orders: 2, grossCents: 14_000 });
    expect(detail.aiSpend).toMatchObject({ costMicros: 6000, calls: 1 });
  });

  it("suspends with a reason, bans in Clerk, audits it, and reinstates — never deleting", async () => {
    expect((await post(ADMIN, `/admin/users/${BUYER}/suspend`, {})).status).toBe(400);
    expect((await post(ADMIN, `/admin/users/${ADMIN}/suspend`, { reason: "x" })).status).toBe(400);
    expect((await post(ADMIN, `/admin/users/${OTHER_ADMIN}/suspend`, { reason: "x" })).status).toBe(403);

    const res = await post(ADMIN, `/admin/users/${BUYER}/suspend`, { reason: "Chargeback abuse" });
    expect(res.status).toBe(200);
    expect(clerkCalls).toContain(`ban:${BUYER}`);
    const [row] = await db.select().from(users).where(eq(users.clerkId, BUYER));
    expect(row).toMatchObject({ suspensionReason: "Chargeback abuse", activeStanding: false });
    expect(row!.suspendedAt).not.toBeNull();

    expect((await auditFor(BUYER)).map((a) => a.action)).toContain("user.suspend");

    expect((await post(ADMIN, `/admin/users/${BUYER}/reinstate`)).status).toBe(200);
    expect(clerkCalls).toContain(`unban:${BUYER}`);
    const [after] = await db.select().from(users).where(eq(users.clerkId, BUYER));
    expect(after!.suspendedAt).toBeNull();
    expect((await post(ADMIN, `/admin/users/${U("nobody")}/reinstate`)).status).toBe(404);
  });

  it("grants and removes the verified badge with the prior state in the audit entry", async () => {
    expect((await post(ADMIN, `/admin/users/${SELLER}/verify`, { verified: "yes" })).status).toBe(400);
    expect((await post(ADMIN, `/admin/users/${SELLER}/verify`, { verified: true })).status).toBe(200);
    let [row] = await db.select().from(users).where(eq(users.clerkId, SELLER));
    expect(row).toMatchObject({ verified: true, verificationStatus: "verified" });
    expect((await post(ADMIN, `/admin/users/${SELLER}/verify`, { verified: false })).status).toBe(200);
    [row] = await db.select().from(users).where(eq(users.clerkId, SELLER));
    expect(row).toMatchObject({ verified: false, verificationStatus: "unverified" });
    const entries = (await auditFor(SELLER)).filter((a) => a.action.startsWith("user.") && a.action.includes("verify"));
    expect(entries.map((e) => e.action).sort()).toEqual(["user.unverify", "user.verify"]);
    expect(entries.find((e) => e.action === "user.verify")!.metadata).toMatchObject({ before: { verified: false } });
  });
});

describe("commerce", () => {
  it("nets refunded platform fees out of revenue and lists refunds", async () => {
    const rev = await (await get(ADMIN, "/admin/revenue?days=7")).json();
    expect(rev.gmvCents).toBeGreaterThanOrEqual(14_000);
    expect(rev.series.length).toBeGreaterThan(0);
    expect(rev.boostRevenueCents).toBeGreaterThanOrEqual(2500);
    const refunds = await (await get(ADMIN, "/admin/refunds")).json();
    const mine = refunds.items.find((o: any) => o.orderNumber === `${P}-2`);
    expect(mine).toMatchObject({ full: true, refundedCents: 4000 });
  });

  it("finds an order by number and returns the detail view", async () => {
    const list = await (await get(ADMIN, `/admin/orders?q=${P}-1`)).json();
    expect(list.items).toHaveLength(1);
    const detail = await (await get(ADMIN, `/admin/orders/${list.items[0].id}`)).json();
    expect(detail).toMatchObject({ orderNumber: `${P}-1`, platformFeeCents: 500 });
    expect((await get(ADMIN, "/admin/orders/not-a-uuid")).status).toBe(404);
    expect((await get(ADMIN, "/admin/orders?status=bogus")).status).toBe(400);
  });
});

describe("audit log", () => {
  it("is append-only at the database level", async () => {
    const [entry] = await db.select().from(adminAuditLog).where(eq(adminAuditLog.actorClerkId, ADMIN)).limit(1);
    await expect(db.update(adminAuditLog).set({ summary: "tampered" }).where(eq(adminAuditLog.id, entry!.id))).rejects.toThrow();
    await expect(db.delete(adminAuditLog).where(eq(adminAuditLog.id, entry!.id))).rejects.toThrow();
  });

  it("lists entries newest first and filters by target", async () => {
    const res = await (await get(ADMIN, `/admin/audit?targetId=${SELLER}`)).json();
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.every((i: any) => i.targetId === SELLER)).toBe(true);
  });

  it("a failed action leaves no audit entry (same transaction)", async () => {
    const before = await auditFor("00000000-0000-0000-0000-000000000000");
    const res = await post(ADMIN, "/admin/boosts/00000000-0000-0000-0000-000000000000/review", { decision: "approve" });
    expect(res.status).toBe(404);
    expect(await auditFor("00000000-0000-0000-0000-000000000000")).toHaveLength(before.length);
  });
});

describe("featured on Discover", () => {
  it("validates targets, publishes only live items, and audits changes", async () => {
    expect((await post(ADMIN, "/admin/featured", { kind: "brand", targetId: BUYER })).status).toBe(404);
    expect((await post(ADMIN, "/admin/featured", { kind: "thread", targetId: randomUUID() })).status).toBe(404);
    expect((await post(ADMIN, "/admin/featured", { kind: "nope", targetId: "x" })).status).toBe(400);

    const brand = await post(ADMIN, "/admin/featured", { kind: "brand", targetId: SELLER, label: "Staff pick", position: 1 });
    expect(brand.status).toBe(201);
    const { id } = await brand.json();
    expect((await post(ADMIN, "/admin/featured", { kind: "thread", targetId: postId })).status).toBe(201);

    const pub = await (await get(null, "/public/featured")).json();
    expect(pub.brands).toContainEqual({ userId: SELLER, label: "Staff pick" });
    expect(pub.threads.map((t: any) => t.postId)).toContain(postId);

    await patch(ADMIN, `/admin/featured/${id}`, { active: false });
    expect((await (await get(null, "/public/featured")).json()).brands.map((b: any) => b.userId)).not.toContain(SELLER);
    await patch(ADMIN, `/admin/featured/${id}`, { active: true });

    // A suspended brand drops off Discover even though the row is still active.
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.clerkId, SELLER));
    expect((await (await get(null, "/public/featured")).json()).brands.map((b: any) => b.userId)).not.toContain(SELLER);
    expect((await post(ADMIN, "/admin/featured", { kind: "brand", targetId: SELLER })).status).toBe(422);
    await db.update(users).set({ suspendedAt: null }).where(eq(users.clerkId, SELLER));

    expect((await del(ADMIN, `/admin/featured/${id}`)).status).toBe(200);
    expect((await auditFor(SELLER)).map((a) => a.action)).toEqual(expect.arrayContaining(["featured.add", "featured.update", "featured.remove"]));
  });
});

describe("announcements", () => {
  it("validates, then fans out to the chosen audience only (in-app + push)", async () => {
    expect((await post(ADMIN, "/admin/announcements", { title: "", body: "b", audience: "all" })).status).toBe(400);
    expect((await post(ADMIN, "/admin/announcements", { title: "t", body: "b", audience: "everyone" })).status).toBe(400);
    expect((await post(ADMIN, "/admin/announcements", { title: "t", body: "b", audience: "all", sendPush: false, sendInApp: false })).status).toBe(400);

    const [created] = await db.insert(adminAnnouncements).values({
      title: "Shipping update", body: "New carriers are live.", audience: "buyers", createdBy: ADMIN,
    }).returning();
    pushes.length = 0;
    await deliverAnnouncement(created!.id);

    const feed = await db.select().from(notificationsFeed).where(eq(notificationsFeed.targetId, created!.id));
    const recipients = feed.map((n) => n.userId);
    expect(recipients).toContain(FAN);
    expect(recipients).not.toContain(SELLER);
    expect(feed.every((n) => n.type === "announcement" && n.title === "Shipping update")).toBe(true);
    expect(pushes).toContain(FAN);
    const [done] = await db.select().from(adminAnnouncements).where(eq(adminAnnouncements.id, created!.id));
    expect(done).toMatchObject({ status: "sent" });
    expect(done!.recipientCount).toBeGreaterThanOrEqual(2);
  });

  it("accepts a send request, records it in the audit log and reports the audience size", async () => {
    const res = await post(ADMIN, "/admin/announcements", { title: "Hello", body: "World", audience: "sellers", sendPush: false });
    expect(res.status).toBe(202);
    const { id } = await res.json();
    expect((await auditFor(id)).map((a) => a.action)).toContain("announcement.send");
    const reach = await (await get(ADMIN, "/admin/announcements/audience?audience=sellers")).json();
    expect(reach.recipients).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, 300));
  });
});

describe("invite codes", () => {
  it("generates distinct codes, enforces max uses, expiry and one redemption per user", async () => {
    expect((await post(ADMIN, "/admin/invites", { count: 0 })).status).toBe(400);
    expect((await post(ADMIN, "/admin/invites", { maxUses: 0 })).status).toBe(400);
    expect((await post(ADMIN, "/admin/invites", { expiresAt: "2001-01-01" })).status).toBe(400);

    const gen = await post(ADMIN, "/admin/invites", { label: "Press", maxUses: 1, count: 3 });
    expect(gen.status).toBe(201);
    const { codes } = await gen.json();
    expect(new Set(codes).size).toBe(3);
    expect(codes.every((c: string) => /^[2-9A-HJ-NP-Z]{8}$/.test(c))).toBe(true);

    const first = await post(BUYER, "/referrals/apply", { code: codes[0] });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, inviterId: null });
    expect((await post(BUYER, "/referrals/apply", { code: codes[1] })).status).toBe(409); // one per user
    expect((await post(FAN, "/referrals/apply", { code: codes[0] })).status).toBe(410);   // single-use, used up
    expect((await post(FAN, "/referrals/apply", { code: "ZZZZZZZZ" })).status).toBe(404);

    const list = await (await get(ADMIN, "/admin/invites")).json();
    expect(list.items.find((c: any) => c.code === codes[0])).toMatchObject({ uses: 1, status: "used up" });

    // A disabled code can't be redeemed; re-enabling restores it.
    const target = list.items.find((c: any) => c.code === codes[2]);
    await post(ADMIN, `/admin/invites/${target.id}/disable`);
    expect((await post(FAN, "/referrals/apply", { code: codes[2] })).status).toBe(404);
    await post(ADMIN, `/admin/invites/${target.id}/enable`);
    expect((await post(FAN, "/referrals/apply", { code: codes[2] })).status).toBe(200);

    await db.update(adminInviteCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(adminInviteCodes.code, codes[1]));
    await db.delete(adminInviteCodeUses).where(eq(adminInviteCodeUses.userId, FAN));
    await db.update(users).set({ referredByCode: null }).where(eq(users.clerkId, FAN));
    expect((await post(FAN, "/referrals/apply", { code: codes[1] })).status).toBe(410);
  });

  it("never lets concurrent redemptions exceed max uses", async () => {
    const { codes } = await (await post(ADMIN, "/admin/invites", { maxUses: 2 })).json();
    const ids = Array.from({ length: 6 }, (_, i) => U(`racer${i}`));
    await db.insert(users).values(ids.map((clerkId) => ({ clerkId, email: `${clerkId}@example.test`, name: clerkId })));
    const results = await Promise.all(ids.map((id) => post(id, "/referrals/apply", { code: codes[0] }).then((r) => r.status)));
    expect(results.filter((s) => s === 200)).toHaveLength(2);
    const [row] = await db.select().from(adminInviteCodes).where(eq(adminInviteCodes.code, codes[0]));
    expect(row!.uses).toBe(2);
    await db.delete(adminInviteCodeUses).where(inArray(adminInviteCodeUses.userId, ids));
    await db.delete(users).where(inArray(users.clerkId, ids));
  });
});

describe("promoted-thread approvals", () => {
  it("lists paid boosts awaiting review, approves once, and rejects with a reason that stops delivery", async () => {
    const pending = await (await get(ADMIN, "/admin/boosts?status=pending")).json();
    expect(pending.items.find((b: any) => b.id === boostId)).toMatchObject({ budgetCents: 2500, thread: { caption: "Spring drop" } });

    expect((await post(ADMIN, `/admin/boosts/${boostId}/review`, { decision: "maybe" })).status).toBe(400);
    expect((await post(ADMIN, `/admin/boosts/${boostId}/review`, { decision: "reject" })).status).toBe(400);

    const [second] = await db.insert(boosts).values({
      sellerId: SELLER, targetType: "post", targetId: postId, budgetCents: 1000, status: "active",
      paidAt: new Date(), endsAt: new Date(Date.now() + 86_400_000),
    }).returning();

    expect((await post(ADMIN, `/admin/boosts/${boostId}/review`, { decision: "approve" })).status).toBe(200);
    expect((await post(ADMIN, `/admin/boosts/${boostId}/review`, { decision: "approve" })).status).toBe(409);
    expect((await db.select().from(boosts).where(eq(boosts.id, boostId)))[0]!.status).toBe("active");

    expect((await post(ADMIN, `/admin/boosts/${second!.id}/review`, { decision: "reject", reason: "Misleading claim" })).status).toBe(200);
    expect((await db.select().from(boosts).where(eq(boosts.id, second!.id)))[0]!.status).toBe("cancelled");
    const note = await db.select().from(notificationsFeed).where(eq(notificationsFeed.targetId, second!.id));
    expect(note[0]).toMatchObject({ userId: SELLER, type: "boost_rejected", body: "Misleading claim" });
    expect((await auditFor(second!.id)).map((a) => a.action)).toContain("boost.reject");
    expect(await db.select().from(boostReviews).where(inArray(boostReviews.boostId, [boostId, second!.id]))).toHaveLength(2);

    const still = await (await get(ADMIN, "/admin/boosts?status=pending")).json();
    expect(still.items.map((b: any) => b.id)).not.toContain(boostId);
  });
});

describe("AI spend", () => {
  it("prices known models from tokens, flags unknown ones, and ranks users by spend", async () => {
    expect(priceAiUsage("gpt-4.1", 1_000_000, 1_000_000)).toEqual({ costMicros: 10_000_000, priced: true });
    expect(priceAiUsage("gpt-4.1-mini-2025-04-14", 1000, 1000)).toEqual({ costMicros: 2000, priced: true });
    expect(priceAiUsage("mystery-model", 1000, 1000)).toEqual({ costMicros: 0, priced: false });

    await recordAiUsage({ feature: "image", model: "gpt-image-1", inputTokens: 500, outputTokens: 4000 }, BUYER);
    await recordAiUsage({ feature: "chat", model: "mystery-model", inputTokens: 10, outputTokens: 10 }, BUYER);
    await recordAiUsage({ feature: "chat", model: "gpt-4.1", inputTokens: 0, outputTokens: 0 }, BUYER); // empty: ignored

    const spend = await (await get(ADMIN, "/admin/ai-spend?days=1&limit=100")).json();
    const buyer = spend.items.find((i: any) => i.userId === BUYER);
    expect(buyer).toMatchObject({ costMicros: 162_500, calls: 2, unpricedCalls: 1 });
    const seller = spend.items.find((i: any) => i.userId === SELLER);
    expect(seller.costMicros).toBe(6000);
    const order = spend.items.map((i: any) => i.costMicros);
    expect(order).toEqual([...order].sort((a, b) => b - a));
    expect(spend.unpricedCalls).toBeGreaterThanOrEqual(1);
  });
});

describe("overview", () => {
  it("summarises the platform", async () => {
    const o = await (await get(ADMIN, "/admin/overview")).json();
    expect(o.users).toBeGreaterThanOrEqual(5);
    expect(o.platformFees30dCents).toBeGreaterThanOrEqual(500);
    expect(typeof o.openReports).toBe("number");
    expect(sql).toBeDefined();
  });
});

describe("moderation audit trail", () => {
  it("records successful moderator mutations and ignores reads and failures", async () => {
    const { auditModerationActions } = await import("../../lib/admin/moderationAudit");
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.clerkUserId = req.headers["x-test-acting-as"]; next(); });
    const stub = express.Router();
    stub.get("/reports", (_req, res) => { res.json({ items: [] }); });
    stub.post("/reports/:id/resolve", (req, res) => { res.status(req.params.id === "bad" ? 422 : 200).json({ ok: true }); });
    stub.post("/users/:userId/reinstate", (_req, res) => { res.json({ ok: true }); });
    app.use("/api/moderation", auditModerationActions, stub);
    const srv = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/moderation`;
    const h = { "content-type": "application/json", "x-test-acting-as": ADMIN };
    const reportId = randomUUID();
    await fetch(`${url}/reports`, { headers: h });
    await fetch(`${url}/reports/bad/resolve`, { method: "POST", headers: h, body: JSON.stringify({ action: "dismiss" }) });
    await fetch(`${url}/reports/${reportId}/resolve`, { method: "POST", headers: h, body: JSON.stringify({ action: "remove_content" }) });
    await fetch(`${url}/users/${BUYER}/reinstate`, { method: "POST", headers: h, body: "{}" });
    await new Promise((r) => setTimeout(r, 150));
    srv.close();

    const resolved = await auditFor(reportId);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ action: "moderation.resolve", actorClerkId: ADMIN, metadata: { action: "remove_content" } });
    expect(await auditFor("bad")).toHaveLength(0);
    expect((await auditFor(BUYER)).map((a) => a.action)).toContain("user.reinstate");
  });
});
