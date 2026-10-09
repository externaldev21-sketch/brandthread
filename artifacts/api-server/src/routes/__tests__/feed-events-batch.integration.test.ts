/**
 * POST /api/feed/events writes the whole batch in one INSERT ... ON CONFLICT
 * DO NOTHING ... RETURNING and folds the taste-profile update into one
 * read + one upsert. These tests pin that the result is identical to the old
 * per-event path (applyEventToProfile once per inserted event, in order) and
 * that client_event_id dedupe still holds within and across batches.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { buyerTasteProfiles, db, feedNotInterested, forYouFeedCache, interactions, posts } from "@workspace/db";
import { applyEventToProfile } from "../../lib/ranking/forYou";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
  requireModerator: (_req: any, res: any) => { res.status(403).json({ error: "Moderator access required" }); },
}));

const suffix = crypto.randomBytes(5).toString("hex");
const sellerA = `feed-batch-seller-a-${suffix}`;
const sellerB = `feed-batch-seller-b-${suffix}`;
const batchUser = `feed-batch-user-${suffix}`;
const referenceUser = `feed-batch-ref-${suffix}`;
const replayUser = `feed-batch-replay-${suffix}`;
const allUsers = [batchUser, referenceUser, replayUser];

let server: Server;
let base = "";
let postA = "";
let postB = "";
let postHide = "";
const createdPostIds: string[] = [];

async function makePost(userId: string, styleTags: string[]) {
  const [p] = await db.insert(posts).values({
    userId,
    mediaUrl: `https://cdn.example.test/${suffix}/${crypto.randomUUID()}.mp4`,
    mediaType: "video",
    caption: "batch",
    postStatus: "published",
    styleTags,
  } as any).returning({ id: posts.id });
  createdPostIds.push(p.id);
  return p.id;
}

async function sendEvents(userId: string, events: unknown[]) {
  const response = await fetch(`${base}/api/feed/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user-id": userId },
    body: JSON.stringify({ events }),
  });
  return { status: response.status, body: await response.json() as any };
}

async function profileOf(userId: string) {
  const [row] = await db.select().from(buyerTasteProfiles).where(eq(buyerTasteProfiles.userId, userId)).limit(1);
  return row;
}

beforeAll(async () => {
  postA = await makePost(sellerA, ["streetwear", "denim"]);
  postB = await makePost(sellerB, ["minimal"]);
  postHide = await makePost(sellerB, ["formal", "denim"]);

  const { default: feed } = await import("../feed");
  const app = express();
  app.use(express.json());
  app.use("/api/feed", feed);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(interactions).where(inArray(interactions.userId, allUsers));
  await db.delete(feedNotInterested).where(inArray(feedNotInterested.userId, allUsers));
  await db.delete(forYouFeedCache).where(inArray(forYouFeedCache.userId, allUsers));
  await db.delete(buyerTasteProfiles).where(inArray(buyerTasteProfiles.userId, allUsers));
  if (createdPostIds.length) await db.delete(posts).where(inArray(posts.id, createdPostIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/feed/events (batched)", () => {
  it("produces exactly the profile the per-event path produced, and dedupes in-batch repeats and unknown posts", async () => {
    // Seed both users with the same pre-existing profile so the fold starts
    // from a real row (the read-modify-write path, not just the insert path).
    const seed = { categoryAffinity: { tops: 1 }, styleTagAffinity: { denim: 0.5 }, sellerAffinity: { [sellerA]: 0.2 }, eventCount: 3 };
    await db.insert(buyerTasteProfiles).values([
      { userId: batchUser, ...seed },
      { userId: referenceUser, ...seed },
    ]);

    const missingPost = crypto.randomUUID();
    const events = [
      { postId: postA, type: "view", clientEventId: `e1-${suffix}` },
      { postId: postB, type: "watch_time", value: "0.75", clientEventId: `e2-${suffix}` },
      { postId: postA, type: "skip", clientEventId: `e3-${suffix}` },
      { postId: postA, type: "view", clientEventId: `e1-${suffix}` }, // repeated id in the same batch
      { postId: missingPost, type: "view", clientEventId: `e4-${suffix}` }, // unknown post: skipped
      { postId: postB, type: "rewatch", clientEventId: `e5-${suffix}` },
      { postId: postHide, type: "not_interested", clientEventId: `e6-${suffix}` },
      { postId: postA, type: "shop_click", clientEventId: `e7-${suffix}` },
      { postId: postB, type: "add_to_bag", clientEventId: `e8-${suffix}` },
    ];

    const res = await sendEvents(batchUser, events);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 7, deduped: 2 });

    // Old behavior: applyEventToProfile once per newly inserted event, in order.
    const postMeta: Record<string, { sellerId: string; styleTags: string[] }> = {
      [postA]: { sellerId: sellerA, styleTags: ["streetwear", "denim"] },
      [postB]: { sellerId: sellerB, styleTags: ["minimal"] },
      [postHide]: { sellerId: sellerB, styleTags: ["formal", "denim"] },
    };
    const seen = new Set<string>();
    for (const e of events) {
      if (!postMeta[e.postId] || seen.has(e.clientEventId)) continue;
      seen.add(e.clientEventId);
      await applyEventToProfile(referenceUser, {
        type: e.type,
        value: (e as any).value ?? null,
        styleTags: postMeta[e.postId].styleTags,
        sellerId: postMeta[e.postId].sellerId,
      });
    }

    const batched = await profileOf(batchUser);
    const reference = await profileOf(referenceUser);
    expect(batched.eventCount).toBe(reference.eventCount);
    expect(batched.eventCount).toBe(3 + 7);
    for (const key of ["categoryAffinity", "styleTagAffinity", "sellerAffinity"] as const) {
      const a = batched[key] as Record<string, number>;
      const b = reference[key] as Record<string, number>;
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      for (const k of Object.keys(b)) expect(a[k]).toBeCloseTo(b[k], 10);
    }

    // Every stored event row carries its client id; the in-batch repeat and the unknown post were not stored.
    const stored = await db.select({ clientEventId: interactions.clientEventId, type: interactions.type, value: interactions.value })
      .from(interactions)
      .where(and(eq(interactions.userId, batchUser), isNotNull(interactions.clientEventId)));
    expect(stored.map((r) => r.clientEventId).sort()).toEqual(
      ["e1", "e2", "e3", "e5", "e6", "e7", "e8"].map((p) => `${p}-${suffix}`).sort(),
    );
    expect(stored.find((r) => r.clientEventId === `e2-${suffix}`)).toEqual(expect.objectContaining({ type: "watch_time", value: "0.75" }));

    // not_interested still persists the For You hide.
    const hides = await db.select().from(feedNotInterested)
      .where(and(eq(feedNotInterested.userId, batchUser), eq(feedNotInterested.postId, postHide)));
    expect(hides).toHaveLength(1);
  });

  it("a replayed batch is fully deduped and leaves the profile untouched", async () => {
    const events = [
      { postId: postA, type: "view", clientEventId: `r1-${suffix}` },
      { postId: postB, type: "skip", clientEventId: `r2-${suffix}` },
    ];
    const first = await sendEvents(replayUser, events);
    expect(first.body).toEqual({ accepted: 2, deduped: 0 });
    const before = await profileOf(replayUser);
    expect(before.eventCount).toBe(2);

    const replay = await sendEvents(replayUser, events);
    expect(replay.status).toBe(202);
    expect(replay.body).toEqual({ accepted: 0, deduped: 2 });
    const after = await profileOf(replayUser);
    expect(after.eventCount).toBe(before.eventCount);
    expect(after.styleTagAffinity).toEqual(before.styleTagAffinity);
    expect(after.sellerAffinity).toEqual(before.sellerAffinity);
  });
});
