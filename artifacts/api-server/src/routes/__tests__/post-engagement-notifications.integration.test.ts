import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, notificationsFeed, posts, users } from "@workspace/db";

vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return { ...actual, sendPushToUser: async () => true };
});

const suffix = crypto.randomBytes(6).toString("hex");
const owner = `eng-owner-${suffix}`;
const fan = `eng-fan-${suffix}`;
const tagged = `eng-tagged-${suffix}`;
const ids = [owner, fan, tagged];
let postId = "";

beforeAll(async () => {
  await db.insert(users).values(ids.map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId, role: "buyer", accountType: "buyer",
  })));
  const [post] = await db.insert(posts).values({
    userId: owner, mediaUrl: `https://cdn.example.test/${suffix}/v.mp4`, mediaType: "video", caption: "Drop", postStatus: "published",
  }).returning({ id: posts.id });
  postId = post.id;
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ids));
  await db.delete(posts).where(inArray(posts.userId, ids));
  await db.delete(users).where(inArray(users.clerkId, ids));
});

describe("save / share / tag notifications", () => {
  it("notifies the post owner once per person, never for self-actions", async () => {
    const { notifyPostSave, notifyPostShare, notifyPostTag } = await import("../../lib/activityEvents");
    await notifyPostSave({ postId, saverId: fan });
    await notifyPostSave({ postId, saverId: fan });
    await notifyPostShare({ postId, sharerId: fan });
    await notifyPostShare({ postId, sharerId: fan });
    await notifyPostSave({ postId, saverId: owner });
    await notifyPostTag({ postId, taggerId: owner, taggedUserId: tagged });
    await notifyPostTag({ postId, taggerId: owner, taggedUserId: owner });

    const rows = await db.select().from(notificationsFeed).where(inArray(notificationsFeed.userId, ids));
    const summary = rows.map((r) => `${r.userId === owner ? "owner" : "tagged"}:${r.type}:${r.title}`).sort();
    expect(summary).toEqual([
      `owner:post_save:${fan} saved your post`,
      `owner:post_share:${fan} shared your post`,
      `tagged:post_tag:${owner} tagged you in a post`,
    ]);
    expect(rows.every((r) => r.category === "social" && r.targetType === "post" && r.targetId === postId)).toBe(true);
  });
});
