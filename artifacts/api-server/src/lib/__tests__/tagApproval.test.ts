import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  notified: [] as Array<{ userId: string; type: string }>,
  approvers: new Set<string>(),
  blocked: new Set<string>(),
  profiles: new Map<string, { userId: string; name: string; handle: string; initials: string; deleted: boolean; suspended: boolean }>(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c, count: () => "count", desc: (v: unknown) => v, eq: (...v: unknown[]) => v,
}));
vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({
      values: (rows: Array<Record<string, unknown>>) => {
        state.inserted.push(...rows);
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  },
  posts: {}, postUserTags: {}, stories: {}, storyMentions: {}, users: {},
}));
vi.mock("../../routes/notifications-feed", () => ({
  publishNotification: async (n: { userId: string; type: string }) => { state.notified.push({ userId: n.userId, type: n.type }); },
}));
vi.mock("../activityEvents", () => ({
  actorFieldsFromProfile: (p: { userId: string; name: string; handle: string }) => ({
    actorId: p.userId, actorName: p.name, actorHandle: p.handle, actorInitials: "T", actorColor: "#000",
  }),
  postThumbnail: () => "thumb.jpg",
}));
vi.mock("../safety", () => ({
  blockedUserIds: async () => state.blocked,
  profilesById: async (ids: string[]) => new Map(ids.filter((id) => state.profiles.has(id)).map((id) => [id, state.profiles.get(id)!])),
}));
vi.mock("../interactionSettings", () => ({
  usersRequiringTagApproval: async (ids: string[]) => new Set(ids.filter((id) => state.approvers.has(id))),
  tagStatusFor: (tagged: string, tagger: string, approvers: Set<string>) => tagged !== tagger && approvers.has(tagged) ? "pending" : "approved",
}));
vi.mock("../logger", () => ({ logger: { warn: () => undefined } }));

import { cleanTaggedUserIds, isTagKind, MAX_POST_USER_TAGS, recordPostUserTags } from "../tagApproval";

const profile = (userId: string, extra: Partial<{ deleted: boolean; suspended: boolean }> = {}) =>
  ({ userId, name: userId, handle: `@${userId}`, initials: "X", deleted: false, suspended: false, ...extra });
const POST = { thumbnailUrl: null, mediaUrl: "m.jpg", mediaUrls: [], mediaType: "photo" };

beforeEach(() => {
  state.inserted = [];
  state.notified = [];
  state.approvers = new Set();
  state.blocked = new Set();
  state.profiles = new Map(["tagger", "open", "approver", "blocked", "gone"].map((id) => [id, profile(id, id === "gone" ? { deleted: true } : {})]));
});

describe("cleanTaggedUserIds", () => {
  it("dedupes, drops the author and caps the list", () => {
    expect(cleanTaggedUserIds("me", undefined)).toEqual([]);
    expect(cleanTaggedUserIds("me", [" a ", "a", "me", ""])).toEqual(["a"]);
    expect(cleanTaggedUserIds("me", "a")).toBeNull();
    expect(cleanTaggedUserIds("me", [1])).toBeNull();
    expect(cleanTaggedUserIds("me", Array.from({ length: MAX_POST_USER_TAGS + 1 }, (_, i) => `u${i}`))).toBeNull();
  });

  it("knows the tag kinds", () => {
    expect(isTagKind("post")).toBe(true);
    expect(isTagKind("story")).toBe(true);
    expect(isTagKind("reel")).toBe(false);
  });
});

describe("recordPostUserTags", () => {
  it("stores pending tags for manual approvers without notifying them", async () => {
    state.approvers = new Set(["approver"]);
    state.blocked = new Set(["blocked"]);
    const result = await recordPostUserTags({
      postId: "p1", taggerId: "tagger", taggedUserIds: ["open", "approver", "blocked", "gone", "unknown"], notify: true, post: POST,
    });
    expect(result).toEqual({ approved: ["open"], pending: ["approver"] });
    expect(state.inserted).toEqual([
      { postId: "p1", taggedUserId: "open", status: "approved" },
      { postId: "p1", taggedUserId: "approver", status: "pending" },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(state.notified).toEqual([{ userId: "open", type: "post_tag" }]);
  });

  it("does not notify while the post isn't public", async () => {
    await recordPostUserTags({ postId: "p1", taggerId: "tagger", taggedUserIds: ["open"], notify: false, post: POST });
    expect(state.inserted).toHaveLength(1);
    expect(state.notified).toEqual([]);
  });

  it("does nothing for an empty list", async () => {
    expect(await recordPostUserTags({ postId: "p1", taggerId: "tagger", taggedUserIds: [], notify: true, post: POST }))
      .toEqual({ approved: [], pending: [] });
    expect(state.inserted).toEqual([]);
  });
});
