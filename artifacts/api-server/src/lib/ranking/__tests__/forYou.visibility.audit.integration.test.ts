import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, follows, posts, users } from "@workspace/db";
import { computeForYouRankingForUser } from "../forYou";

// Audit: For You candidate generation must only rank posts that are publicly
// visible (publicPostCondition). The /api/feed/for-you route hydrates the
// ranked ids with no further moderation/visibility filter, so anything the
// ranking returns is served.
const suffix = crypto.randomBytes(6).toString("hex");
const buyer = `fy-vis-buyer-${suffix}`;
const seller = `fy-vis-seller-${suffix}`;
const suspended = `fy-vis-suspended-${suffix}`;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: buyer, email: `${buyer}@test.local`, name: buyer, role: "buyer", accountType: "buyer" },
    { clerkId: seller, email: `${seller}@test.local`, name: seller, role: "owner", accountType: "seller" },
    { clerkId: suspended, email: `${suspended}@test.local`, name: suspended, role: "owner", accountType: "seller", suspendedAt: new Date() },
  ]);
  // The buyer follows both sellers, so every post is also a followed candidate.
  await db.insert(follows).values([
    { followerId: buyer, followingId: seller },
    { followerId: buyer, followingId: suspended },
  ]);
  const base = { mediaUrl: "https://example.test/p.jpg", surface: "thread", postStatus: "published" };
  const rows = await db.insert(posts).values([
    { ...base, userId: seller, caption: `visible ${suffix}` },
    { ...base, userId: seller, caption: `removed ${suffix}`, moderationStatus: "removed" },
    { ...base, userId: seller, caption: `held ${suffix}`, moderationStatus: "held" },
    {
      ...base, userId: seller, caption: `private ${suffix}`,
      visibility: { isPublic: false, allowComments: true, allowReposts: true, showLikeCount: true },
    },
    { ...base, userId: suspended, caption: `suspended ${suffix}` },
  ]).returning({ id: posts.id, caption: posts.caption });
  for (const r of rows) ids[String(r.caption).split(" ")[0]] = r.id;
});

afterAll(async () => {
  await db.delete(posts).where(inArray(posts.id, Object.values(ids)));
  await db.delete(follows).where(inArray(follows.followerId, [buyer]));
  await db.delete(users).where(inArray(users.clerkId, [buyer, seller, suspended]));
});

describe("computeForYouRankingForUser visibility (audit)", () => {
  it("ranks only publicly visible posts", async () => {
    const ranked = await computeForYouRankingForUser(buyer);
    const rankedIds = new Set(ranked.map((r) => r.postId));
    expect(rankedIds.has(ids.visible)).toBe(true);
    expect(rankedIds.has(ids.removed)).toBe(false);
    expect(rankedIds.has(ids.held)).toBe(false);
    expect(rankedIds.has(ids.private)).toBe(false);
    expect(rankedIds.has(ids.suspended)).toBe(false);
  });
});
