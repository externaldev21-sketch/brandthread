/**
 * Admin dashboard → held content, repeat infringers and ranking weights.
 * Real DB + real admin router; `requireAuth` reads the caller off a header
 * (same substitution admin-dashboard.integration.test.ts uses).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, inArray, like } from "drizzle-orm";
import { adminAuditLog, db, ipCases, postComments, posts, products, rankingConfig, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", async (orig) => ({
  ...(await orig<typeof import("../../middlewares/requireAuth")>()),
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
}));

import adminRouter from "../admin";
import { RANKING_CONFIG_KEY, invalidateRankingConfigCache } from "../../lib/ranking/config";

const P = `asf${process.pid}`;
const U = (n: string) => `${P}-${n}`;
const ADMIN = U("admin"), SUSPENDED_ADMIN = U("admin-off"), SELLER = U("seller"), BUYER = U("buyer"), CLEAN = U("clean");

let server: Server;
let base = "";
let savedRanking: typeof rankingConfig.$inferSelect | undefined;
const savedEnv = process.env.RANKING_WEIGHTS_JSON;

function call(user: string | null, path: string, init: RequestInit = {}) {
  return fetch(`${base}/api/admin${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(user ? { "x-test-acting-as": user } : {}) },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) as any }));
}
const get = (u: string | null, p: string) => call(u, p);
const post = (u: string | null, p: string, body?: unknown) => call(u, p, { method: "POST", body: JSON.stringify(body ?? {}) });
const patch = (u: string | null, p: string, body?: unknown) => call(u, p, { method: "PATCH", body: JSON.stringify(body ?? {}) });

let heldPostId = "", heldCommentId = "", productId = "";

beforeAll(async () => {
  delete process.env.RANKING_WEIGHTS_JSON;
  [savedRanking] = await db.select().from(rankingConfig).where(eq(rankingConfig.key, RANKING_CONFIG_KEY));
  const mk = (clerkId: string, extra: Partial<typeof users.$inferInsert> = {}) => ({ clerkId, email: `${clerkId}@example.test`, name: clerkId, ...extra });
  await db.insert(users).values([
    mk(ADMIN, { role: "admin" }),
    mk(SUSPENDED_ADMIN, { role: "admin", suspendedAt: new Date() }),
    mk(SELLER, { role: "owner", accountType: "seller", brandName: "Knockoff Co", ipStrikeCount: 3, ipRepeatInfringer: true, ipRepeatInfringerFlaggedAt: new Date() }),
    mk(BUYER, { role: "buyer", accountType: "buyer" }),
    mk(CLEAN, { role: "owner", accountType: "seller" }),
  ]);
  const [p] = await db.insert(posts).values({ userId: SELLER, mediaUrl: "https://example.test/held.jpg", caption: "held caption", moderationStatus: "held", moderationReason: "Matched the text filter" }).returning();
  heldPostId = p!.id;
  const [visible] = await db.insert(posts).values({ userId: SELLER, mediaUrl: "https://example.test/ok.jpg", caption: "fine" }).returning();
  const [c] = await db.insert(postComments).values({ postId: visible!.id, authorId: BUYER, body: "held comment body", moderationStatus: "held", moderationReason: "slur" }).returning();
  heldCommentId = c!.id;
  const [prod] = await db.insert(products).values({ ownerId: SELLER, name: "Fake Logo Tee" } as any).returning();
  productId = prod!.id;
  // One case linked by seller_id, one only through the listing owner.
  await db.insert(ipCases).values([
    { publicReference: `${P}-A`, statusTokenHash: "x", claimantName: "Rights Co", claimantEmail: "r@example.test", rightsType: "trademark", description: "Uses our logo", status: "actioned", sellerId: SELLER, strikeAppliedAt: new Date(), takedownAt: new Date() },
    { publicReference: `${P}-B`, statusTokenHash: "y", claimantName: "Rights Co", claimantEmail: "r@example.test", rightsType: "copyright", description: "Copied photo", status: "submitted", listingProductId: productId },
  ] as any);

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error() {}, warn() {}, info() {} }; next(); });
  app.use("/api/admin", adminRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(rankingConfig).where(eq(rankingConfig.key, RANKING_CONFIG_KEY));
  if (savedRanking) await db.insert(rankingConfig).values(savedRanking);
  invalidateRankingConfigCache();
  if (savedEnv !== undefined) process.env.RANKING_WEIGHTS_JSON = savedEnv;
  await db.delete(ipCases).where(like(ipCases.publicReference, `${P}-%`));
  await db.delete(products).where(eq(products.ownerId, SELLER));
  await db.delete(postComments).where(eq(postComments.authorId, BUYER));
  await db.delete(posts).where(eq(posts.userId, SELLER));
  await db.delete(users).where(like(users.clerkId, `${P}-%`));
});

describe("admin gate", () => {
  it("refuses signed-out, non-admin and suspended-admin callers", async () => {
    for (const path of ["/held", "/held/counts", "/repeat-infringers", "/ranking"]) {
      expect((await get(null, path)).status).toBe(401);
      expect((await get(BUYER, path)).status).toBe(403);
      expect((await get(SUSPENDED_ADMIN, path)).status).toBe(403);
    }
    expect((await post(BUYER, `/held/post/${heldPostId}/approve`)).status).toBe(403);
    expect((await patch(BUYER, "/ranking", { scoreWeights: { affinity: 9 } })).status).toBe(403);
  });
});

describe("held content", () => {
  it("lists held items with a preview and reason, then approves and removes them (audited)", async () => {
    const list = await get(ADMIN, "/held?type=all&limit=100");
    expect(list.status).toBe(200);
    const mine = list.body.items.filter((i: any) => i.id === heldPostId || i.id === heldCommentId);
    expect(mine.map((i: any) => i.type).sort()).toEqual(["comment", "post"]);
    const p = mine.find((i: any) => i.type === "post");
    expect(p).toMatchObject({ text: "held caption", reason: "Matched the text filter" });
    expect(p.mediaUrls).toContain("https://example.test/held.jpg");

    expect((await post(ADMIN, `/held/post/${heldPostId}/approve`)).status).toBe(200);
    const [after] = await db.select({ s: posts.moderationStatus }).from(posts).where(eq(posts.id, heldPostId));
    expect(after!.s).toBe("visible");
    expect((await post(ADMIN, `/held/post/${heldPostId}/approve`)).status).toBe(409);

    expect((await post(ADMIN, `/held/comment/${heldCommentId}/remove`)).status).toBe(200);
    const [c] = await db.select({ s: postComments.moderationStatus }).from(postComments).where(eq(postComments.id, heldCommentId));
    expect(c!.s).toBe("removed");

    await new Promise((r) => setTimeout(r, 50)); // audit is written on response finish
    const audit = await db.select().from(adminAuditLog).where(inArray(adminAuditLog.targetId, [heldPostId, heldCommentId]));
    expect(audit.map((a) => a.action).sort()).toEqual(["moderation.held.approve", "moderation.held.remove"]);
  });
});

describe("repeat infringers", () => {
  it("lists sellers with strikes and their cases, and clears the flag (audited)", async () => {
    const res = await get(ADMIN, "/repeat-infringers");
    expect(res.status).toBe(200);
    expect(typeof res.body.threshold).toBe("number");
    const s = res.body.sellers.find((x: any) => x.userId === SELLER);
    expect(s).toMatchObject({ ipStrikeCount: 3, ipRepeatInfringer: true, brandName: "Knockoff Co" });
    expect(s.cases.map((c: any) => c.reference).sort()).toEqual([`${P}-A`, `${P}-B`]);
    expect(s.cases.find((c: any) => c.reference === `${P}-A`)).toMatchObject({ strike: true, status: "actioned" });
    expect(s.cases.find((c: any) => c.reference === `${P}-B`).listingName).toBe("Fake Logo Tee");
    expect(res.body.sellers.some((x: any) => x.userId === CLEAN)).toBe(false);

    expect((await post(ADMIN, `/repeat-infringers/${U("nobody")}/clear`)).status).toBe(404);
    const cleared = await post(ADMIN, `/repeat-infringers/${SELLER}/clear`, {});
    expect(cleared.body).toMatchObject({ ok: true, ipRepeatInfringer: false, ipStrikeCount: 3 });
    const reset = await post(ADMIN, `/repeat-infringers/${SELLER}/clear`, { resetStrikes: true });
    expect(reset.body.ipStrikeCount).toBe(0);
    const [u] = await db.select().from(users).where(eq(users.clerkId, SELLER));
    expect(u).toMatchObject({ ipStrikeCount: 0, ipRepeatInfringer: false });
    const audit = await db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, SELLER));
    expect(audit.filter((a) => a.action === "ip.repeat_infringer.clear")).toHaveLength(2);
  });
});

describe("ranking weights", () => {
  it("shows code defaults, persists clamped edits, and resets", async () => {
    await db.delete(rankingConfig).where(eq(rankingConfig.key, RANKING_CONFIG_KEY));
    invalidateRankingConfigCache();
    const first = await get(ADMIN, "/ranking");
    expect(first.status).toBe(200);
    expect(first.body.stored).toBe(false);
    expect(first.body.envOverride).toBe(false);
    expect(first.body.config).toEqual(first.body.defaults);
    expect(first.body.defaults.scoreWeights.affinity).toBe(3);

    expect((await patch(ADMIN, "/ranking", [1, 2])).status).toBe(400);
    const saved = await patch(ADMIN, "/ranking", { scoreWeights: { affinity: 5.5, trending: 999 }, eventWeights: { like: 2.5 }, recencyHalfLifeHours: 24 });
    expect(saved.status).toBe(200);
    expect(saved.body.stored).toBe(true);
    expect(saved.body.config.scoreWeights).toMatchObject({ affinity: 5.5, trending: 20, freshness: 1.5 });
    expect(saved.body.config.eventWeights.like).toBe(2.5);
    const [row] = await db.select().from(rankingConfig).where(eq(rankingConfig.key, RANKING_CONFIG_KEY));
    expect((row!.value as any).scoreWeights.affinity).toBe(5.5);

    const reset = await post(ADMIN, "/ranking/reset");
    expect(reset.body.config).toEqual(reset.body.defaults);
    const audit = await db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, RANKING_CONFIG_KEY));
    expect(audit.filter((a) => a.actorClerkId === ADMIN).map((a) => a.action)).toEqual(["ranking.update", "ranking.update"]);
  });
});

