/**
 * Item 82: comment / reply / mention notifications carry the exact comment
 * (notifications_feed.comment_id, migration 101) so the Activity row and the
 * push both open that comment, not just the post.
 *
 * Mocked `@workspace/db` (see social-search-accounts.test.ts's file banner
 * for why this sandbox can't run a real-Postgres integration test here).
 */
import { describe, expect, it, vi } from "vitest";

const inserted = vi.hoisted(() => [] as any[]);
const pushes = vi.hoisted(() => [] as any[]);

vi.mock("@workspace/db", () => {
  const tableStub = (name: string) => new Proxy({}, {
    get: (_t, prop) => (typeof prop === "string" ? `${name}.${prop}` : undefined),
  });
  const chain = (result: any): any => {
    const obj: any = {
      from: () => obj, where: () => obj, orderBy: () => obj, limit: () => obj, offset: () => obj,
      values: (v: any) => { inserted.push(v); return obj; },
      onConflictDoNothing: () => obj,
      returning: () => Promise.resolve([{ id: "n-1" }]),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return obj;
  };
  return {
    users: tableStub("users"),
    blocks: tableStub("blocks"),
    follows: tableStub("follows"),
    activityMutes: tableStub("activityMutes"),
    notificationsFeed: tableStub("notificationsFeed"),
    db: { select: vi.fn(() => chain([])), insert: vi.fn(() => chain([])) },
  };
});

vi.mock("../../lib/push", () => ({
  normalizePushEventCategory: () => "social",
  // lib/notificationChannels.ts (in-app channel switch): no per-type key → enabled.
  preferenceKey: () => null,
  sendPushToUser: vi.fn(async (_userId: string, payload: any) => { pushes.push(payload); }),
}));

describe("notifications feed — comment id", () => {
  it("stores the comment, sends it in the push, and returns it from the feed", async () => {
    const { publishNotification, adapt } = await import("../notifications-feed");
    await publishNotification({
      userId: "owner-1", category: "social", type: "post_comment", title: "Jay commented on your post",
      body: "love this", targetId: "post-1", targetType: "post", commentId: "comment-9",
    });
    expect(inserted[0]).toMatchObject({ targetId: "post-1", commentId: "comment-9" });
    expect(pushes[0].data).toMatchObject({ targetId: "post-1", commentId: "comment-9", type: "post_comment" });

    const row = adapt({
      id: "n-1", userId: "owner-1", category: "social", type: "post_comment", title: "x", body: "",
      isRead: false, isMuted: false, actorName: null, actorHandle: null, actorInitials: null, actorColor: null,
      targetId: "post-1", targetType: "post", cta: null, actorId: null, targetImageUrl: null,
      commentId: "comment-9", createdAt: new Date(),
    } as any);
    expect(row).toMatchObject({ targetId: "post-1", commentId: "comment-9" });
  });

  it("leaves it off rows that aren't about a comment", async () => {
    const { adapt } = await import("../notifications-feed");
    const row = adapt({
      id: "n-2", userId: "u", category: "social", type: "post_like", title: "x", body: "",
      isRead: false, isMuted: false, actorName: null, actorHandle: null, actorInitials: null, actorColor: null,
      targetId: "post-1", targetType: "post", cta: null, actorId: null, targetImageUrl: null,
      commentId: null, createdAt: new Date(),
    } as any);
    expect(row.commentId).toBeUndefined();
  });
});
