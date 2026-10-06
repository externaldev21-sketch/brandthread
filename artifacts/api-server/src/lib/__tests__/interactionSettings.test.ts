import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** Results handed to successive select queries, in order. */
  results: [] as unknown[][],
  tables: [] as string[],
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (...values: unknown[]) => values,
  inArray: (...values: unknown[]) => values,
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ name }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : String(key),
  });
  const next = () => Promise.resolve(state.results.shift() ?? []);
  return {
    db: {
      select: () => ({
        from: (selected: { name: string }) => {
          state.tables.push(selected.name);
          return {
            where: () => ({
              limit: () => next(),
              then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => next().then(resolve, reject),
            }),
          };
        },
      }),
    },
    follows: table("follows"),
    storyHiddenViewers: table("story_hidden_viewers"),
    userInteractionSettings: table("user_interaction_settings"),
  };
});

import {
  DEFAULT_INTERACTION_SETTINGS,
  authorsHidingStoriesFrom,
  cleanHiddenUserIds,
  commentAllowed,
  commentRefusal,
  interactionSettingsPatchSchema,
  normalizeInteractionSettings,
  repostsAllowedBy,
  storyHiddenBodySchema,
  storyHiddenFrom,
} from "../interactionSettings";

beforeEach(() => {
  state.results = [];
  state.tables = [];
});

describe("normalizeInteractionSettings", () => {
  it("defaults to open settings when nothing is stored", () => {
    expect(normalizeInteractionSettings(null)).toEqual(DEFAULT_INTERACTION_SETTINGS);
    expect(DEFAULT_INTERACTION_SETTINGS).toEqual({ commentAudience: "everyone", allowReposts: true, allowDownloads: true });
  });

  it("keeps stored values and drops unknown ones", () => {
    expect(normalizeInteractionSettings({ commentAudience: "following", allowReposts: false, allowDownloads: false }))
      .toEqual({ commentAudience: "following", allowReposts: false, allowDownloads: false });
    expect(normalizeInteractionSettings({ commentAudience: "friends", allowReposts: "no" as unknown as boolean }))
      .toEqual(DEFAULT_INTERACTION_SETTINGS);
  });
});

describe("request schemas", () => {
  it("accepts a partial patch and refuses unknown audiences", () => {
    expect(interactionSettingsPatchSchema.safeParse({ allowDownloads: false }).success).toBe(true);
    expect(interactionSettingsPatchSchema.safeParse({ commentAudience: "nobody" }).success).toBe(true);
    expect(interactionSettingsPatchSchema.safeParse({ commentAudience: "friends" }).success).toBe(false);
    expect(interactionSettingsPatchSchema.safeParse({ allowReposts: "true" }).success).toBe(false);
  });

  it("caps the hidden-story list", () => {
    expect(storyHiddenBodySchema.safeParse({ userIds: ["a", "b"] }).success).toBe(true);
    expect(storyHiddenBodySchema.safeParse({ userIds: Array.from({ length: 1001 }, (_, i) => `u${i}`) }).success).toBe(false);
  });
});

describe("commentAllowed", () => {
  it("always lets the owner comment", () => {
    expect(commentAllowed({ audience: "nobody", isOwner: true, ownerFollowsCommenter: false })).toBe(true);
  });

  it("applies each audience to everyone else", () => {
    expect(commentAllowed({ audience: "everyone", isOwner: false, ownerFollowsCommenter: false })).toBe(true);
    expect(commentAllowed({ audience: "following", isOwner: false, ownerFollowsCommenter: true })).toBe(true);
    expect(commentAllowed({ audience: "following", isOwner: false, ownerFollowsCommenter: false })).toBe(false);
    expect(commentAllowed({ audience: "nobody", isOwner: false, ownerFollowsCommenter: true })).toBe(false);
  });
});

describe("commentRefusal", () => {
  it("never refuses the owner and skips the lookup", async () => {
    expect(await commentRefusal("owner", "owner")).toBeNull();
    expect(state.tables).toEqual([]);
  });

  it("allows anyone under the default setting", async () => {
    state.results = [[]];
    expect(await commentRefusal("owner", "stranger")).toBeNull();
  });

  it("refuses people the owner does not follow under 'following'", async () => {
    state.results = [[{ commentAudience: "following", allowReposts: true, allowDownloads: true }], []];
    expect(await commentRefusal("owner", "stranger")).toEqual({ message: "Only people this account follows can comment." });
    expect(state.tables).toEqual(["user_interaction_settings", "follows"]);
  });

  it("allows people the owner follows under 'following'", async () => {
    state.results = [[{ commentAudience: "following", allowReposts: true, allowDownloads: true }], [{ followerId: "owner" }]];
    expect(await commentRefusal("owner", "friend")).toBeNull();
  });

  it("refuses everyone else under 'nobody'", async () => {
    state.results = [[{ commentAudience: "nobody", allowReposts: true, allowDownloads: true }]];
    expect(await commentRefusal("owner", "friend")).toEqual({ message: "This account has turned off comments." });
  });
});

describe("repostsAllowedBy", () => {
  it("reads the owner's stored switch", async () => {
    state.results = [[{ commentAudience: "everyone", allowReposts: false, allowDownloads: true }]];
    expect(await repostsAllowedBy("owner")).toBe(false);
    state.results = [[]];
    expect(await repostsAllowedBy("owner")).toBe(true);
  });
});

describe("hidden story viewers", () => {
  it("cleans the list: trimmed, unique, never the owner", () => {
    expect(cleanHiddenUserIds("me", [" a ", "a", "me", "", "b"])).toEqual(["a", "b"]);
  });

  it("finds the authors hiding their stories from a viewer", async () => {
    state.results = [[{ ownerId: "author-2" }]];
    const hiding = await authorsHidingStoriesFrom("viewer", ["viewer", "author-1", "author-2"]);
    expect([...hiding]).toEqual(["author-2"]);
  });

  it("never hides an author's stories from themself", async () => {
    expect(await storyHiddenFrom("me", "me")).toBe(false);
    expect(await authorsHidingStoriesFrom("me", ["me"])).toEqual(new Set());
    expect(state.tables).toEqual([]);
  });

  it("reports a single hidden author", async () => {
    state.results = [[{ ownerId: "author" }]];
    expect(await storyHiddenFrom("author", "viewer")).toBe(true);
    state.results = [[]];
    expect(await storyHiddenFrom("author", "viewer")).toBe(false);
  });
});
