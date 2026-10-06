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
  SUGGESTED_SNOOZE_DAYS,
  activeSnoozeUntil,
  applyInteractionPatch,
  suggestedPostsSnoozed,
  tagStatusFor,
  usersRequiringTagApproval,
  withoutSuggestedWhenSnoozed,
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
    expect(DEFAULT_INTERACTION_SETTINGS).toEqual({
      commentAudience: "everyone", allowReposts: true, allowDownloads: true,
      manualTagApproval: false, remixAudience: "everyone", suggestedSnoozedUntil: null,
    });
  });

  it("keeps stored values and drops unknown ones", () => {
    expect(normalizeInteractionSettings({ commentAudience: "following", allowReposts: false, allowDownloads: false }))
      .toEqual({ ...DEFAULT_INTERACTION_SETTINGS, commentAudience: "following", allowReposts: false, allowDownloads: false });
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

describe("tag approval, remix audience and snooze settings (migration 119)", () => {
  const NOW = new Date("2026-10-06T12:00:00Z");

  it("keeps a future snooze and drops an expired one", () => {
    expect(activeSnoozeUntil("2026-10-20T00:00:00Z", NOW)).toBe("2026-10-20T00:00:00.000Z");
    expect(activeSnoozeUntil(new Date("2026-10-01T00:00:00Z"), NOW)).toBeNull();
    expect(activeSnoozeUntil(null, NOW)).toBeNull();
    expect(activeSnoozeUntil("garbage", NOW)).toBeNull();
  });

  it("normalizes the new columns", () => {
    expect(normalizeInteractionSettings({
      manualTagApproval: true, remixAudience: "following", suggestedSnoozedUntil: new Date("2026-11-01T00:00:00Z"),
    }, NOW)).toMatchObject({ manualTagApproval: true, remixAudience: "following", suggestedSnoozedUntil: "2026-11-01T00:00:00.000Z" });
    expect(normalizeInteractionSettings({ remixAudience: "friends", manualTagApproval: "yes" as unknown as boolean }, NOW))
      .toMatchObject({ remixAudience: "everyone", manualTagApproval: false });
  });

  it("turns snoozeSuggested into a 30-day end time, and false ends it", () => {
    const snoozed = applyInteractionPatch(DEFAULT_INTERACTION_SETTINGS, { snoozeSuggested: true }, NOW);
    expect(snoozed.suggestedSnoozedUntil).toBe(new Date(NOW.getTime() + SUGGESTED_SNOOZE_DAYS * 86_400_000).toISOString());
    expect(applyInteractionPatch(snoozed, { snoozeSuggested: false }, NOW).suggestedSnoozedUntil).toBeNull();
    expect(applyInteractionPatch(snoozed, { remixAudience: "off" }, NOW)).toMatchObject({
      remixAudience: "off", suggestedSnoozedUntil: snoozed.suggestedSnoozedUntil,
    });
  });

  it("validates the new patch fields", () => {
    expect(interactionSettingsPatchSchema.safeParse({ manualTagApproval: true, remixAudience: "off", snoozeSuggested: true }).success).toBe(true);
    expect(interactionSettingsPatchSchema.safeParse({ remixAudience: "friends" }).success).toBe(false);
    expect(interactionSettingsPatchSchema.safeParse({ snoozeSuggested: "yes" }).success).toBe(false);
  });

  it("marks a tag pending only for accounts that approve tags manually (never self-tags)", async () => {
    state.results = [[{ userId: "approver" }]];
    const approvers = await usersRequiringTagApproval(["approver", "open"]);
    expect(approvers).toEqual(new Set(["approver"]));
    expect(tagStatusFor("approver", "tagger", approvers)).toBe("pending");
    expect(tagStatusFor("open", "tagger", approvers)).toBe("approved");
    expect(tagStatusFor("approver", "approver", approvers)).toBe("approved");
    expect(await usersRequiringTagApproval([])).toEqual(new Set());
  });

  it("only treats a stored future snooze as snoozed; signed-out viewers never are", async () => {
    expect(await suggestedPostsSnoozed(null)).toBe(false);
    state.results = [[{ suggestedSnoozedUntil: new Date(Date.now() + 86_400_000) }]];
    expect(await suggestedPostsSnoozed("viewer")).toBe(true);
    state.results = [[{ suggestedSnoozedUntil: new Date(Date.now() - 1000) }]];
    expect(await suggestedPostsSnoozed("viewer")).toBe(false);
  });

  it("filters a ranked feed to followed authors and self while snoozed", async () => {
    const items = [{ sellerId: "followed" }, { sellerId: "stranger" }, { sellerId: "viewer" }];
    state.results = [[{ suggestedSnoozedUntil: new Date(Date.now() + 86_400_000) }], [{ id: "followed" }]];
    expect(await withoutSuggestedWhenSnoozed("viewer", items, (i) => i.sellerId))
      .toEqual([{ sellerId: "followed" }, { sellerId: "viewer" }]);
    state.results = [[]];
    expect(await withoutSuggestedWhenSnoozed("viewer", items, (i) => i.sellerId)).toEqual(items);
  });
});
