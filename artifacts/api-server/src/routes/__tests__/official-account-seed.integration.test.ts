import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, officialSeedImpressions, officialSeedProgress, pool, posts, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { OFFICIAL_ACCOUNT_CLERK_ID, OFFICIAL_SEED_FLAG_KEY } from "../../lib/officialSeed/config";
import { resetPoolSizeCache } from "../../lib/officialSeed/service";

/**
 * @brandthread official account: admins post as it, its posts obey the
 * OFFICIAL_SEED_CONTENT_PUBLIC flag, and brand-new users get them seeded into
 * the Threads feed (slot 1, then spaced) until each has been seen once.
 */

const suffix = crypto.randomBytes(6).toString("hex");
const adminId = `official-seed-admin-${suffix}`;
const sellerId = `official-seed-seller-${suffix}`;
const newBuyerId = `official-seed-new-${suffix}`;
const oldBuyerId = `official-seed-old-${suffix}`;
const creditUserId = `official-seed-credit-${suffix}`;
const creditHandle = `creator_${suffix}`;
const postIds: string[] = [];

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id") ?? "";
    if (!req.clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
    next();
  },
  requireModerator: (_req: any, res: any) => res.status(403).json({ error: "Moderator access required" }),
}));
vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: () => void) => next(),
}));

let server: Server;
let base = "";

async function request(path: string, userId: string | null, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-test-user-id": userId } : {}),
      ...(options.headers ?? {}),
    },
  });
  return { status: response.status, body: await response.json() as any };
}

async function setFlag(enabled: boolean | null) {
  if (enabled === null) {
    await pool.query("DELETE FROM feature_flags WHERE key = $1", [OFFICIAL_SEED_FLAG_KEY]);
    return;
  }
  await pool.query(
    `INSERT INTO feature_flags (key, enabled, description) VALUES ($1, $2, 'test')
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [OFFICIAL_SEED_FLAG_KEY, enabled],
  );
}

async function postAsOfficial(caption: string, extra: Record<string, unknown> = {}) {
  const res = await request("/api/posts", adminId, {
    method: "POST",
    body: JSON.stringify({
      postAs: "brandthread",
      mediaType: "video",
      mediaUrl: `https://cdn.test/official-${crypto.randomUUID()}.mp4`,
      caption,
      surface: "thread",
      ...extra,
    }),
  });
  if (res.body?.id) postIds.push(res.body.id);
  return res;
}

beforeAll(async () => {
  const dayAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
  await db.insert(users).values([
    { clerkId: adminId, email: `${adminId}@test.local`, name: "Dev", role: "admin", accountType: "buyer", createdAt: dayAgo(90) },
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Real Seller", role: "owner", accountType: "seller", brandName: "Real Seller" },
    { clerkId: newBuyerId, email: `${newBuyerId}@test.local`, name: "New Buyer", role: "buyer", accountType: "buyer", createdAt: new Date() },
    { clerkId: oldBuyerId, email: `${oldBuyerId}@test.local`, name: "Old Buyer", role: "buyer", accountType: "buyer", createdAt: dayAgo(30) },
    { clerkId: creditUserId, email: `${creditUserId}@test.local`, name: "Creator", role: "buyer", accountType: "buyer", username: creditHandle },
  ]);
  const [official] = await db.select({ clerkId: users.clerkId }).from(users).where(eq(users.clerkId, OFFICIAL_ACCOUNT_CLERK_ID));
  if (!official) throw new Error("migration 270 did not seed the official account");

  const [{ default: postsRouter }, { default: publicRouter }, { default: feedRouter }, { default: mediaRouter }, { default: socialRouter }, { profileLanding }] = await Promise.all([
    import("../posts"), import("../public"), import("../feed"), import("../profile-media"), import("../social"), import("../profileLanding"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { const id = req.header("x-test-user-id"); if (id) req.clerkUserId = id; next(); });
  app.use("/api/posts", postsRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/public", mediaRouter);
  app.use("/api/feed", feedRouter);
  app.use("/api/social", socialRouter);
  app.get("/u/:username", profileLanding);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => resetPoolSizeCache());

afterAll(async () => {
  await setFlag(null);
  if (postIds.length > 0) {
    await db.delete(officialSeedImpressions).where(inArray(officialSeedImpressions.postId, postIds));
    await db.delete(posts).where(inArray(posts.id, postIds));
  }
  await db.delete(officialSeedProgress).where(inArray(officialSeedProgress.userId, [newBuyerId, oldBuyerId]));
  await db.delete(users).where(inArray(users.clerkId, [adminId, sellerId, newBuyerId, oldBuyerId, creditUserId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Post as @brandthread", () => {
  it("lets an admin publish a Thread authored by the official account, with a credit", async () => {
    const res = await postAsOfficial("Official starter video", { creditHandle: `@${creditHandle.toUpperCase()}`, creditName: "Bully Monday" });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(OFFICIAL_ACCOUNT_CLERK_ID);
    expect(res.body.postedAs).toBe("brandthread");
    expect(res.body.credit).toEqual({ handle: creditHandle, name: "Bully Monday", userId: creditUserId, accountType: "buyer" });
  });

  it("keeps an unknown creator credit untappable", async () => {
    const res = await postAsOfficial("Unknown creator", { creditHandle: "galoreyyz" });
    expect(res.status).toBe(201);
    expect(res.body.credit).toMatchObject({ handle: "galoreyyz", userId: null });
  });

  it("refuses non-admins and credits on normal posts", async () => {
    const asSeller = await request("/api/posts", sellerId, {
      method: "POST",
      body: JSON.stringify({ postAs: "brandthread", mediaType: "video", mediaUrl: "https://cdn.test/x.mp4", caption: "nope" }),
    });
    expect(asSeller.status).toBe(403);
    expect(asSeller.body.code).toBe("POST_AS_FORBIDDEN");
    const credited = await request("/api/posts", sellerId, {
      method: "POST",
      body: JSON.stringify({ mediaType: "video", mediaUrl: "https://cdn.test/y.mp4", caption: "mine", creditHandle: "someone" }),
    });
    expect(credited.status).toBe(400);
    expect(credited.body.code).toBe("CREDIT_REQUIRES_OFFICIAL");
  });

  it("lists official posts for admins only", async () => {
    expect((await request("/api/posts/official", sellerId)).status).toBe(403);
    const res = await request("/api/posts/official", adminId);
    expect(res.status).toBe(200);
    expect(res.body.posts.map((p: any) => p.id)).toEqual(expect.arrayContaining(postIds.slice(0, 2)));
  });
});

describe("OFFICIAL_SEED_CONTENT_PUBLIC", () => {
  it("hides official posts from non-admins while off; admins always see them", async () => {
    await setFlag(false);
    const asBuyer = await request(`/api/public/posts?ownerId=${OFFICIAL_ACCOUNT_CLERK_ID}`, newBuyerId);
    expect(asBuyer.body.map((p: any) => p.id)).not.toContain(postIds[0]);
    const signedOut = await request(`/api/public/posts?ownerId=${OFFICIAL_ACCOUNT_CLERK_ID}`, null);
    expect(signedOut.body.map((p: any) => p.id)).not.toContain(postIds[0]);
    const asAdmin = await request(`/api/public/posts?ownerId=${OFFICIAL_ACCOUNT_CLERK_ID}`, adminId);
    const adminPost = asAdmin.body.find((p: any) => p.id === postIds[0]);
    expect(adminPost?.seller).toMatchObject({ username: "brandthread", isOfficial: true });
    expect(adminPost?.credit?.handle).toBe(creditHandle);
    // Off for non-admins means no seeding either.
    const seed = await request("/api/feed/official-seed", newBuyerId);
    expect(seed.body.seeding).toBe(false);
  });

  it("shows official posts to everyone once on", async () => {
    await setFlag(true);
    const asBuyer = await request(`/api/public/posts?ownerId=${OFFICIAL_ACCOUNT_CLERK_ID}`, newBuyerId);
    expect(asBuyer.body.map((p: any) => p.id)).toContain(postIds[0]);
  });
});

describe("official profile identity and access", () => {
  const paths = [
    `/api/public/sellers/${OFFICIAL_ACCOUNT_CLERK_ID}`,
    "/api/public/profiles/brandthread",
    `/api/public/users/${OFFICIAL_ACCOUNT_CLERK_ID}/videos`,
  ];

  it("hides every direct profile entry when off, but allows admins", async () => {
    await setFlag(false);
    for (const path of paths) {
      expect((await request(path, null)).status, path).toBe(404);
      expect((await request(path, newBuyerId)).status, path).toBe(404);
      expect((await request(path, adminId)).status, path).toBe(200);
    }
    expect((await fetch(`${base}/u/brandthread`)).status).toBe(404);
    expect((await fetch(`${base}/u/brandthread`, { headers: { "x-test-user-id": adminId } })).status).toBe(200);
  });

  it("resolves the real official identity, empty cover and newest-first grid when on", async () => {
    await setFlag(true);
    const profile = await request("/api/public/profiles/brandthread", null);
    expect(profile.body).toMatchObject({
      username: "brandthread", displayName: "Brandthread",
      bio: "The official Brandthread account.", isOfficial: true, verified: true,
    });
    const seller = await request(`/api/public/sellers/${profile.body.id}`, null);
    expect(seller.body.profile).toMatchObject({
      clerkId: OFFICIAL_ACCOUNT_CLERK_ID, coverVideoUrl: null, profileBanner: null,
    });
    const grid = await request(`/api/public/users/${profile.body.id}/videos?limit=50`, null);
    expect(grid.status).toBe(200);
    expect(grid.body.videos.length).toBeGreaterThan(0);
    const times = grid.body.videos.map((p: any) => new Date(p.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    for (const row of grid.body.videos) expect(row.authorId ?? row.userId).toBe(OFFICIAL_ACCOUNT_CLERK_ID);
  });

  it("persists following across reads, is idempotent, and undoes it", async () => {
    await setFlag(true);
    const path = `/api/public/sellers/${OFFICIAL_ACCOUNT_CLERK_ID}`;
    const before = (await request(path, null)).body.profile.followersCount;
    try {
      for (let n = 0; n < 2; n++) {
        const follow = await request("/api/social/follow", newBuyerId, {
          method: "POST", body: JSON.stringify({ userId: OFFICIAL_ACCOUNT_CLERK_ID }),
        });
        expect(follow.status).toBe(200);
      }
      expect((await request(path, oldBuyerId)).body.profile.followersCount).toBe(before + 1);
    } finally {
      expect((await request(`/api/social/follow/${OFFICIAL_ACCOUNT_CLERK_ID}`, newBuyerId, { method: "DELETE" })).status).toBe(200);
    }
    expect((await request(path, null)).body.profile.followersCount).toBe(before);
  });

  it("finds the real official account in search only when allowed", async () => {
    await setFlag(true);
    const on = await request("/api/public/search?q=brandthread", null);
    expect(on.status).toBe(200);
    expect(on.body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: OFFICIAL_ACCOUNT_CLERK_ID, kind: "brand", handle: "@brandthread", isOfficial: true }),
    ]));
    await setFlag(false);
    const off = await request("/api/public/search?q=brandthread", null);
    expect(off.body.results.some((row: any) => row.id === OFFICIAL_ACCOUNT_CLERK_ID)).toBe(false);
    const admin = await request("/api/public/search?q=brandthread", adminId);
    expect(admin.body.results.some((row: any) => row.id === OFFICIAL_ACCOUNT_CLERK_ID)).toBe(true);
  });
});

describe("new-user seeding", () => {
  let organicIds: string[] = [];

  beforeAll(async () => {
    await setFlag(true);
    const rows = await db.insert(posts).values(Array.from({ length: 6 }, (_, i) => ({
      userId: sellerId,
      mediaUrl: `https://cdn.test/real-${suffix}-${i}.mp4`,
      mediaType: "video",
      caption: `Real thread ${i}`,
      surface: "thread",
      postStatus: "published",
      publishedAt: new Date(),
    }))).returning({ id: posts.id });
    organicIds = rows.map((r) => r.id);
    postIds.push(...organicIds);
  });

  it("puts an official Thread in slot 1 for a brand-new user, then spaces them", async () => {
    const res = await request(`/api/feed/official-seed?organicIds=${organicIds.join(",")}&last=1`, newBuyerId);
    expect(res.status).toBe(200);
    expect(res.body.seeding).toBe(true);
    const kinds = res.body.items.map((i: any) => i.type);
    expect(kinds[0]).toBe("official");
    expect(res.body.items[0].post.seller.isOfficial).toBe(true);
    kinds.forEach((k: string, i: number) => { if (i > 0 && k === "official") expect(kinds[i - 1]).toBe("organic"); });
    const officialSlots = kinds.flatMap((k: string, i: number) => (k === "official" ? [i + 1] : []));
    expect(officialSlots[1] - officialSlots[0]).toBe(res.body.every);
    // Each served official is unique.
    const officialIds = res.body.items.filter((i: any) => i.type === "official").map((i: any) => i.post.id);
    expect(new Set(officialIds).size).toBe(officialIds.length);
  });

  it("never re-serves an official Thread already served this session", async () => {
    const first = await request(`/api/feed/official-seed?organicIds=${organicIds.join(",")}`, newBuyerId);
    const served = first.body.items.filter((i: any) => i.type === "official").map((i: any) => i.post.id);
    const next = await request(
      `/api/feed/official-seed?organicIds=${organicIds.join(",")}&exclude=${served.join(",")}&position=${first.body.cursor.position}&lastOfficialPosition=${first.body.cursor.lastOfficialPosition}`,
      newBuyerId,
    );
    const again = next.body.seeding ? next.body.items.filter((i: any) => i.type === "official").map((i: any) => i.post.id) : [];
    expect(again.filter((id: string) => served.includes(id))).toEqual([]);
  });

  it("drops seen official posts to normal ranking and stops once all are seen", async () => {
    const res = await request(`/api/feed/official-seed?organicIds=${organicIds.join(",")}`, newBuyerId);
    const firstOfficial = res.body.items.find((i: any) => i.type === "official").post.id;
    const seen = await request("/api/feed/official-seed/progress", newBuyerId, {
      method: "POST", body: JSON.stringify({ seenPostIds: [firstOfficial, organicIds[0]], viewedCount: 3 }),
    });
    expect(seen.status).toBe(202);
    expect(seen.body.recorded).toBe(1); // the organic id is ignored
    const after = await request(`/api/feed/official-seed?organicIds=${organicIds.join(",")}`, newBuyerId);
    const ids = after.body.seeding ? after.body.items.filter((i: any) => i.type === "official").map((i: any) => i.post.id) : [];
    expect(ids).not.toContain(firstOfficial);

    // Mark every official post seen → seeding ends.
    const all = await db.select({ id: posts.id }).from(posts).where(eq(posts.userId, OFFICIAL_ACCOUNT_CLERK_ID));
    await db.insert(officialSeedImpressions).values(all.map((p) => ({ userId: newBuyerId, postId: p.id }))).onConflictDoNothing();
    const done = await request(`/api/feed/official-seed?organicIds=${organicIds.join(",")}`, newBuyerId);
    expect(done.body).toMatchObject({ seeding: false, reason: "all_seen" });
  });

  it("leaves existing (older) users on normal ranking", async () => {
    const res = await request(`/api/feed/official-seed?organicIds=${organicIds.join(",")}`, oldBuyerId);
    expect(res.body).toMatchObject({ seeding: false, reason: "not_new_user" });
  });

  it("ends the window after ~50 Threads viewed", async () => {
    await db.delete(officialSeedImpressions).where(eq(officialSeedImpressions.userId, newBuyerId));
    await request("/api/feed/official-seed/progress", newBuyerId, {
      method: "POST", body: JSON.stringify({ viewedCount: 60 }),
    });
    const res = await request(`/api/feed/official-seed?organicIds=${organicIds.join(",")}`, newBuyerId);
    expect(res.body).toMatchObject({ seeding: false, reason: "threads_viewed" });
  });

  it("lets admins preview the new-user experience regardless of age", async () => {
    const plain = await request(`/api/feed/official-seed?organicIds=${organicIds.join(",")}`, adminId);
    expect(plain.body.seeding).toBe(false);
    const preview = await request(`/api/feed/official-seed?organicIds=${organicIds.join(",")}&preview=1`, adminId);
    expect(preview.body).toMatchObject({ seeding: true, preview: true });
    const ignored = await request(`/api/feed/official-seed?organicIds=${organicIds.join(",")}&preview=1`, oldBuyerId);
    expect(ignored.body.preview).toBe(false);
  });

  it("rejects malformed queries", async () => {
    expect((await request("/api/feed/official-seed?organicIds=not-a-uuid", newBuyerId)).status).toBe(400);
    expect((await request("/api/feed/official-seed?position=-1", newBuyerId)).status).toBe(400);
  });
});
