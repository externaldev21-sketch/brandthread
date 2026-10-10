import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import {
  blocks, db, follows, giveawayDraws, giveawayEntries, giveaways, giveawayWinners,
  notificationDeliveries, notificationsFeed, postComments, posts, pushTokens, users,
} from "@workspace/db";
import { hashEligible } from "../../lib/giveaways";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
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

const sfx = crypto.randomBytes(5).toString("hex");
const id = (n: string) => `gw-${sfx}-${n}`;
const S = id("seller");
const O = id("other");
const names = ["u1", "u2", "u3", "u4", "u5", "u6", "f1", "f2", "f3"];
const everyone = [S, O, ...names.map(id)];
const pushed: string[] = [];
let server: Server;
let base = "";
let postId = "";
let g1: any;
let g1Winner: string;

async function api(method: string, path: string, as: string | null, body?: unknown, prefix = "/api/seller/giveaways") {
  const r = await fetch(`${base}${prefix}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(as ? { "x-test-user-id": as } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() as any };
}
const pub = (path: string, as: string | null) => api("GET", path, as, undefined, "/api/giveaways");

const realFetch = globalThis.fetch;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

beforeAll(async () => {
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://exp.host/")) {
      const messages = JSON.parse(init.body) as { to: string }[];
      for (const m of messages) pushed.push(m.to);
      return new Response(JSON.stringify({ data: messages.map((_, i) => ({ status: "ok", id: `t-${i}` })) }), { status: 200 });
    }
    if (!url.startsWith("http://127.0.0.1")) throw new Error(`Unexpected network call: ${url}`);
    return realFetch(input, init);
  });

  await db.insert(users).values(everyone.map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId, displayName: clerkId,
    username: clerkId.replace(/[^a-z0-9]/gi, "").slice(0, 28), role: "buyer",
    accountType: clerkId === S || clerkId === O ? "seller" : "buyer",
  })));
  const [p] = await db.insert(posts).values({ userId: S, mediaUrl: "https://example.test/p.jpg" }).returning({ id: posts.id });
  postId = p!.id;
  // u1..u6 follow S; u3 does not (removed below); f1..f3 follow O.
  await db.insert(follows).values([
    ...["u1", "u2", "u4", "u5", "u6"].map((n) => ({ followerId: id(n), followingId: S })),
    ...["f1", "f2", "f3"].map((n) => ({ followerId: id(n), followingId: O })),
  ]);
  await db.insert(blocks).values({ blockerId: S, blockedId: id("u5") });
  await db.insert(postComments).values([
    { postId, authorId: id("u1"), body: "Love this jacket" },
    { postId, authorId: id("u2"), body: "Would wear daily" },
    { postId, authorId: id("u2"), body: "Commenting again for luck" },
    { postId, authorId: id("u3"), body: "Not following but commenting" },
    { postId, authorId: id("u4"), body: "@a @b @c" },
    { postId, authorId: id("u5"), body: "I am blocked but commenting" },
    { postId, authorId: S, body: "Thanks everyone" },
  ]);
  await db.insert(pushTokens).values(names.map((n) => ({ userId: id(n), token: `ExponentPushToken[gw-${sfx}-${n}]`, platform: "ios" })));

  const { sellerGiveawaysRouter, publicGiveawaysRouter } = await import("../giveaways");
  const app = express();
  app.use(express.json());
  app.use("/api/seller/giveaways", sellerGiveawaysRouter);
  app.use("/api/giveaways", publicGiveawaysRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
  const feed = await db.select({ id: notificationsFeed.id }).from(notificationsFeed).where(inArray(notificationsFeed.userId, everyone));
  if (feed.length) await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.notificationId, feed.map((f) => f.id)));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, everyone));
  await db.delete(giveaways).where(like(giveaways.sellerId, `gw-${sfx}-%`)); // cascades entries/draws/winners
  await db.delete(postComments).where(eq(postComments.postId, postId));
  await db.delete(posts).where(eq(posts.id, postId));
  await db.delete(blocks).where(inArray(blocks.blockerId, everyone));
  await db.delete(follows).where(inArray(follows.followingId, everyone));
  await db.delete(pushTokens).where(inArray(pushTokens.userId, everyone));
  await db.delete(users).where(inArray(users.clerkId, everyone));
});

describe("giveaway creation", () => {
  it("rejects invalid input and someone else's post", async () => {
    const base_ = { title: "Jacket giveaway", prizeText: "The black jacket", rulesText: "NO PURCHASE NECESSARY", startsAt: iso(-86_400_000), endsAt: iso(3_600_000), winnerCount: 1, postId };
    expect((await api("POST", "/", S, { ...base_, winnerCount: 0 })).status).toBe(400);
    expect((await api("POST", "/", O, base_)).body.code).toBe("INVALID_REFERENCE");
  });

  it("creates a giveaway with a share link, and refuses an overlapping one", async () => {
    const r = await api("POST", "/", S, {
      title: "Jacket giveaway", prizeText: "The black jacket", rulesText: "NO PURCHASE NECESSARY TO ENTER",
      startsAt: iso(-86_400_000), endsAt: iso(3_600_000), winnerCount: 1, postId, region: "US", eligibility: "18+",
    });
    expect(r.status).toBe(201);
    expect(r.body.phase).toBe("live");
    expect(r.body.shareUrl).toBe(`https://brandthread.app/g/${r.body.shareCode}`);
    g1 = r.body;
    const dup = await api("POST", "/", S, {
      title: "Second", prizeText: "x", rulesText: "rules", startsAt: iso(-1000), endsAt: iso(7_200_000), winnerCount: 1,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("GIVEAWAY_OVERLAP");
  });

  it("returns an editable rules template that says no purchase necessary", async () => {
    const r = await api("GET", "/rules-template?prizeText=A%20jacket&winnerCount=2&postEntry=1", S);
    expect(r.body.rulesText).toMatch(/NO PURCHASE NECESSARY/);
    expect(r.body.rulesText).toContain("A jacket");
  });
});

describe("buyer-facing entry", () => {
  it("shows the live giveaway on the seller's profile lookup and each viewer's own entry status", async () => {
    const live = await pub(`/seller/${S}/live`, id("u1"));
    expect(live.body.giveaway.id).toBe(g1.id);
    expect(live.body.giveaway.me).toMatchObject({ followed: true, commented: true, eligible: true });
    const spam = await pub(`/${g1.shareCode}`, id("u4"));
    expect(spam.body.me).toMatchObject({ followed: true, commented: false, eligible: false, excludedReason: "spam_comment" });
    const nofollow = await pub(`/${g1.shareCode}`, id("u3"));
    expect(nofollow.body.me).toMatchObject({ followed: false, eligible: false, excludedReason: "not_following" });
    const blocked = await pub(`/${g1.shareCode}`, id("u5"));
    expect(blocked.body.me.excludedReason).toBe("blocked");
    const anon = await pub(`/${g1.shareCode}`, null);
    expect(anon.status).toBe(200);
    expect(anon.body.me).toBeNull();
    expect((await pub("/seller/nobody/live", null)).body.giveaway).toBeNull();
    expect((await pub("/short", null)).status).toBe(404);
  });

  it("one person who follows later becomes eligible on their next view", async () => {
    await db.insert(follows).values({ followerId: id("u3"), followingId: S });
    const r = await pub(`/${g1.shareCode}`, id("u3"));
    expect(r.body.me).toMatchObject({ followed: true, commented: true, eligible: true });
    await db.delete(follows).where(eq(follows.followerId, id("u3")));
  });
});

describe("draw", () => {
  it("cannot draw before the giveaway ends, and other sellers cannot touch it", async () => {
    expect((await api("POST", `/${g1.id}/draw`, S)).body.code).toBe("NOT_ENDED");
    expect((await api("GET", `/${g1.id}`, O)).status).toBe(404);
    expect((await api("POST", `/${g1.id}/draw`, O)).status).toBe(404);
    expect((await api("POST", `/${g1.id}/end`, O)).status).toBe(404);
  });

  it("draws from real follows + comments only: one entry per person, seller/blocked/spam/non-followers excluded", async () => {
    expect((await api("POST", `/${g1.id}/end`, S)).status).toBe(200);
    const r = await api("POST", `/${g1.id}/draw`, S);
    expect(r.status).toBe(201);
    expect(r.body.phase).toBe("drawn");
    expect(r.body.entries.eligible).toBe(2);
    expect(r.body.winners).toHaveLength(1);
    g1Winner = r.body.winners[0].userId;
    expect([id("u1"), id("u2")]).toContain(g1Winner);

    const entries = await db.select().from(giveawayEntries).where(eq(giveawayEntries.giveawayId, g1.id));
    expect(new Set(entries.map((e) => e.userId)).size).toBe(entries.length); // one per person
    expect(entries.filter((e) => e.eligible).map((e) => e.userId).sort()).toEqual([id("u1"), id("u2")].sort());
    expect(entries.find((e) => e.userId === S)?.excludedReason).toBe("seller");
    expect(entries.find((e) => e.userId === id("u5"))?.excludedReason).toBe("blocked");

    const [audit] = await db.select().from(giveawayDraws).where(eq(giveawayDraws.giveawayId, g1.id));
    expect(audit).toMatchObject({ drawNumber: 1, eligibleCount: 2, drawnBy: S });
    expect(audit!.eligibleHash).toBe(hashEligible([id("u1"), id("u2")]));
    expect(audit!.winnerIds).toEqual([g1Winner]);
  });

  it("notifies the winner in-app and by push, and a second draw is refused", async () => {
    const feed = await db.select().from(notificationsFeed).where(eq(notificationsFeed.type, "giveaway_won"));
    const mine = feed.filter((f) => f.userId.startsWith(`gw-${sfx}-`));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.userId).toBe(g1Winner);
    expect(mine[0]).toMatchObject({ targetType: "giveaway", targetId: g1.shareCode });
    expect(pushed).toContain(`ExponentPushToken[gw-${sfx}-${g1Winner.slice(`gw-${sfx}-`.length)}]`);
    expect((await api("POST", `/${g1.id}/draw`, S)).body.code).toBe("ALREADY_DRAWN");
    // Finished giveaway disappears from the profile card; the winner sees that they won.
    expect((await pub(`/seller/${S}/live`, null)).body.giveaway).toBeNull();
    expect((await pub(`/${g1.shareCode}`, g1Winner)).body.youWon).toBe(true);
  });

  it("redraw requires a reason, records the previous winner, and never re-picks a past winner", async () => {
    const detail = (await api("GET", `/${g1.id}`, S)).body;
    const winnerRow = detail.winners[0];
    expect((await api("POST", `/${g1.id}/winners/${winnerRow.id}/redraw`, S, { reason: "" })).body.code).toBe("REASON_REQUIRED");
    const r = await api("POST", `/${g1.id}/winners/${winnerRow.id}/redraw`, S, { reason: "Winner did not respond" });
    expect(r.status).toBe(201);
    const active = r.body.winners.filter((w: any) => w.status === "active");
    const replaced = r.body.winners.filter((w: any) => w.status === "replaced");
    expect(active).toHaveLength(1);
    expect(active[0].userId).not.toBe(g1Winner);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ userId: g1Winner, replacedReason: "Winner did not respond" });
    expect(r.body.draws.map((d: any) => d.drawNumber)).toEqual([1, 2]);
    expect(r.body.draws[1].reason).toBe("Winner did not respond");

    // Nobody eligible is left: a further redraw is refused rather than repeating a winner.
    const again = await api("POST", `/${g1.id}/winners/${active[0].id}/redraw`, S, { reason: "Also unreachable" });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("NO_ELIGIBLE_ENTRIES");
    expect((await api("POST", `/${g1.id}/winners/${winnerRow.id}/redraw`, S, { reason: "again" })).body.code).toBe("ALREADY_REPLACED");
  });

  it("lets the seller mark the prize shipped, and only the owning seller", async () => {
    const detail = (await api("GET", `/${g1.id}`, S)).body;
    const active = detail.winners.find((w: any) => w.status === "active");
    expect((await api("POST", `/${g1.id}/winners/${active.id}/shipped`, O, { shipped: true })).status).toBe(404);
    const r = await api("POST", `/${g1.id}/winners/${active.id}/shipped`, S, { shipped: true });
    expect(r.status).toBe(200);
    expect(r.body.shippedAt).toBeTruthy();
    const [row] = await db.select().from(giveawayWinners).where(eq(giveawayWinners.id, active.id));
    expect(row!.shippedAt).not.toBeNull();
  });

  it("keeps each seller's giveaways separate", async () => {
    expect((await api("GET", "/", O)).body.giveaways).toHaveLength(0);
    expect((await api("GET", "/", S)).body.giveaways).toHaveLength(1);
  });
});

describe("concurrent draws", () => {
  it("lets exactly one of two simultaneous draws win, with no duplicate winners", async () => {
    const created = await api("POST", "/", O, {
      title: "Follow to win", prizeText: "A tee", rulesText: "NO PURCHASE NECESSARY",
      startsAt: iso(-3_600_000), endsAt: iso(3_600_000), winnerCount: 2,
    });
    expect(created.status).toBe(201);
    await api("POST", `/${created.body.id}/end`, O);
    const results = await Promise.all([
      api("POST", `/${created.body.id}/draw`, O),
      api("POST", `/${created.body.id}/draw`, O),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winners = await db.select().from(giveawayWinners).where(eq(giveawayWinners.giveawayId, created.body.id));
    expect(winners).toHaveLength(2);
    expect(new Set(winners.map((w) => w.userId)).size).toBe(2);
    const draws = await db.select().from(giveawayDraws).where(eq(giveawayDraws.giveawayId, created.body.id));
    expect(draws).toHaveLength(1);
  });
});
