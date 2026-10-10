import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  userId: "viewer" as string | null,
  postOwner: null as string | null,
  blocked: false,
  allowDownloads: true,
  saved: [] as Array<Record<string, unknown>>,
  hiddenSaved: [] as string[][],
  pending: [] as Array<{ kind: "post" | "story"; id: string }>,
  approved: [] as string[],
  removed: [] as string[],
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!state.userId) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = state.userId;
    next();
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (...values: unknown[]) => values,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.postOwner ? [{ ownerId: state.postOwner }] : []),
        }),
      }),
    }),
  },
  posts: { id: "id", userId: "user_id" },
}));

vi.mock("../../lib/postVisibility", () => ({ publicPostCondition: () => "public" }));

vi.mock("../../lib/safety", () => ({
  optionalViewerId: () => state.userId,
  isBlockedEitherWay: async () => state.blocked,
}));

vi.mock("../../lib/interactionSettings", async () => {
  const { z } = await import("@workspace/api-zod");
  return {
    interactionSettingsPatchSchema: z.object({
      commentAudience: z.enum(["everyone", "following", "nobody"]).optional(),
      allowReposts: z.boolean().optional(),
      allowDownloads: z.boolean().optional(),
      manualTagApproval: z.boolean().optional(),
      remixAudience: z.enum(["everyone", "following", "off"]).optional(),
      snoozeSuggested: z.boolean().optional(),
    }),
    storyHiddenBodySchema: z.object({ userIds: z.array(z.string().min(1)).max(1000) }),
    loadInteractionSettings: async () => ({
      commentAudience: "everyone",
      allowReposts: true,
      allowDownloads: state.allowDownloads,
    }),
    saveInteractionSettings: async (_userId: string, patch: Record<string, unknown>) => {
      state.saved.push(patch);
      return { commentAudience: "everyone", allowReposts: true, allowDownloads: true, ...patch };
    },
    storyHiddenUserIds: async () => ["hidden-1", "hidden-2"],
    replaceStoryHiddenUserIds: async (_userId: string, userIds: string[]) => {
      state.hiddenSaved.push(userIds);
      return userIds;
    },
  };
});

vi.mock("../../lib/tagApproval", () => ({
  isTagKind: (value: unknown) => value === "post" || value === "story",
  pendingTagCount: async () => state.pending.length,
  listPendingTags: async () => state.pending.map((tag) => ({ ...tag, authorId: "author" })),
  approvePendingTag: async (_userId: string, kind: string, id: string) => {
    const index = state.pending.findIndex((tag) => tag.kind === kind && tag.id === id);
    if (index < 0) return false;
    state.pending.splice(index, 1);
    state.approved.push(`${kind}:${id}`);
    return true;
  },
  removeTag: async (_userId: string, kind: string, id: string) => {
    const index = state.pending.findIndex((tag) => tag.kind === kind && tag.id === id);
    if (index < 0) return false;
    state.pending.splice(index, 1);
    state.removed.push(`${kind}:${id}`);
    return true;
  },
}));

import interactionSettingsRouter from "../interaction-settings";

let server: Server;
let base = "";
const POST_ID = "11111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/interaction-settings", interactionSettingsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/interaction-settings`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.userId = "viewer";
  state.postOwner = "author";
  state.blocked = false;
  state.allowDownloads = true;
  state.saved = [];
  state.hiddenSaved = [];
  state.pending = [];
  state.approved = [];
  state.removed = [];
});

describe("GET /posts/:postId/download", () => {
  it("follows the author's Allow downloads setting", async () => {
    state.allowDownloads = false;
    const res = await fetch(`${base}/posts/${POST_ID}/download`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed: false });

    state.allowDownloads = true;
    expect(await (await fetch(`${base}/posts/${POST_ID}/download`)).json()).toEqual({ allowed: true });
  });

  it("always lets the author save their own post", async () => {
    state.allowDownloads = false;
    state.postOwner = "viewer";
    expect(await (await fetch(`${base}/posts/${POST_ID}/download`)).json()).toEqual({ allowed: true });
  });

  it("answers signed-out visitors without auth", async () => {
    state.userId = null;
    state.allowDownloads = false;
    const res = await fetch(`${base}/posts/${POST_ID}/download`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed: false });
  });

  it("hides the post across a block and for unknown ids", async () => {
    state.blocked = true;
    expect((await fetch(`${base}/posts/${POST_ID}/download`)).status).toBe(404);
    expect((await fetch(`${base}/posts/not-a-uuid/download`)).status).toBe(404);
    state.blocked = false;
    state.postOwner = null;
    expect((await fetch(`${base}/posts/${POST_ID}/download`)).status).toBe(404);
  });
});

describe("account settings", () => {
  it("requires sign-in", async () => {
    state.userId = null;
    expect((await fetch(base)).status).toBe(401);
  });

  it("returns the settings with the hidden-story count", async () => {
    const res = await fetch(base);
    expect(await res.json()).toEqual({
      settings: { commentAudience: "everyone", allowReposts: true, allowDownloads: true },
      storyHiddenCount: 2,
      pendingTagCount: 0,
    });
  });

  it("saves a valid patch and refuses an invalid one", async () => {
    const ok = await fetch(base, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commentAudience: "nobody" }),
    });
    expect(ok.status).toBe(200);
    expect(state.saved).toEqual([{ commentAudience: "nobody" }]);

    const bad = await fetch(base, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commentAudience: "friends" }),
    });
    expect(bad.status).toBe(400);
    expect(state.saved).toHaveLength(1);
  });

  it("replaces the hidden-story list", async () => {
    const res = await fetch(`${base}/story-hidden`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userIds: ["a", "b"] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userIds: ["a", "b"] });
    expect(state.hiddenSaved).toEqual([["a", "b"]]);
  });
});

describe("tag approval, remix and snooze settings", () => {
  const TAG_ID = "22222222-2222-4222-8222-222222222222";

  it("accepts the new settings in a patch and refuses bad values", async () => {
    const ok = await fetch(base, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manualTagApproval: true, remixAudience: "following", snoozeSuggested: true }),
    });
    expect(ok.status).toBe(200);
    expect(state.saved).toEqual([{ manualTagApproval: true, remixAudience: "following", snoozeSuggested: true }]);
    const bad = await fetch(base, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ remixAudience: "friends" }),
    });
    expect(bad.status).toBe(400);
  });

  it("counts and lists pending tags", async () => {
    state.pending = [{ kind: "post", id: TAG_ID }, { kind: "story", id: POST_ID }];
    expect(((await (await fetch(base)).json()) as { pendingTagCount: number }).pendingTagCount).toBe(2);
    const list = await (await fetch(`${base}/pending-tags`)).json() as { items: Array<{ kind: string }> };
    expect(list.items.map((t: { kind: string }) => t.kind)).toEqual(["post", "story"]);
  });

  it("approves a pending tag and returns the new count", async () => {
    state.pending = [{ kind: "post", id: TAG_ID }];
    const res = await fetch(`${base}/pending-tags/post/${TAG_ID}/approve`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pendingTagCount: 0 });
    expect(state.approved).toEqual([`post:${TAG_ID}`]);
  });

  it("removes (untags) and 404s for unknown tags, kinds and ids", async () => {
    state.pending = [{ kind: "story", id: TAG_ID }];
    expect((await fetch(`${base}/tags/story/${TAG_ID}`, { method: "DELETE" })).status).toBe(200);
    expect(state.removed).toEqual([`story:${TAG_ID}`]);
    expect((await fetch(`${base}/tags/story/${TAG_ID}`, { method: "DELETE" })).status).toBe(404);
    expect((await fetch(`${base}/tags/reel/${TAG_ID}`, { method: "DELETE" })).status).toBe(404);
    expect((await fetch(`${base}/pending-tags/post/not-a-uuid/approve`, { method: "POST" })).status).toBe(404);
  });

  it("keeps pending tags behind sign-in", async () => {
    state.userId = null;
    expect((await fetch(`${base}/pending-tags`)).status).toBe(401);
    expect((await fetch(`${base}/pending-tags/post/${TAG_ID}/approve`, { method: "POST" })).status).toBe(401);
  });
});
