import { describe, expect, it, vi } from "vitest";

// Real table definitions (so the SQL renders with real column names), no connection.
vi.mock("@workspace/db", async () => ({ ...(await import("@workspace/db/schema")), db: {}, pool: {} }));

import { PgDialect } from "drizzle-orm/pg-core";
import { FRIENDS_SAVED_LIST_MAX, friendsSavedCondition, shapeFriendsSaved } from "./friendsSaved";
import type { ProfileSummary } from "./safety";

const profile = (userId: string, extra: Partial<ProfileSummary> = {}): ProfileSummary => ({
  userId, name: `Name ${userId}`, handle: `@${userId}`, initials: "NA", avatarUrl: null,
  accountType: "buyer", suspended: false, deleted: false, ...extra,
});

describe("friendsSavedCondition", () => {
  const { sql, params } = new PgDialect().sqlToQuery(friendsSavedCondition("viewer", "prod_1"));

  it("matches this product only, never the viewer's own save", () => {
    expect(sql).toContain('"saved_items"."target_id" = $');
    expect(sql).toContain('"saved_items"."user_id" <> $');
    expect(params).toEqual(expect.arrayContaining(["product", "prod_1", "viewer"]));
  });

  it("respects the saver's Show your saves switch", () => {
    expect(sql).toContain('"users"."show_saves_to_followers" = $');
  });

  it("keeps saves in a private collection private", () => {
    expect(sql).toContain('"saved_items"."collection_id" is null or "saved_collections"."is_public" = $');
  });

  it("drops blocked and suspended people", () => {
    expect(sql).toContain("FROM blocks b");
    expect(sql).toContain("su.suspended_at IS NOT NULL");
  });
});

describe("shapeFriendsSaved", () => {
  it("counts each person once, newest first", () => {
    const out = shapeFriendsSaved(["a", "b", "a"], new Map([["a", profile("a")], ["b", profile("b")]]));
    expect(out.count).toBe(2);
    expect(out.people.map((p) => p.userId)).toEqual(["a", "b"]);
  });

  it("returns only display fields", () => {
    const out = shapeFriendsSaved(["a"], new Map([["a", profile("a")]]));
    expect(Object.keys(out.people[0]).sort()).toEqual(["avatarUrl", "handle", "initials", "name", "userId"]);
  });

  it("is empty when nobody you follow saved it", () => {
    expect(shapeFriendsSaved([], new Map())).toEqual({ count: 0, people: [] });
  });

  it("caps the list but keeps the exact count", () => {
    const ids = Array.from({ length: FRIENDS_SAVED_LIST_MAX + 5 }, (_, i) => `u${i}`);
    const out = shapeFriendsSaved(ids, new Map(ids.map((id) => [id, profile(id)])));
    expect(out.count).toBe(FRIENDS_SAVED_LIST_MAX + 5);
    expect(out.people).toHaveLength(FRIENDS_SAVED_LIST_MAX);
  });

  it("leaves out deleted accounts from the list", () => {
    const out = shapeFriendsSaved(["a", "b"], new Map([["a", profile("a", { deleted: true })], ["b", profile("b")]]));
    expect(out.people.map((p) => p.userId)).toEqual(["b"]);
  });
});
