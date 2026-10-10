import { describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ next: [] as any[][] }));
vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({}, { get: (_t, p) => (typeof p === "string" ? `${name}.${p}` : undefined) });
  const chain = (): any => {
    const c: any = {};
    for (const m of ["from", "where", "limit"]) c[m] = () => c;
    c.then = (res: any, rej: any) => Promise.resolve(rows.next.shift() ?? []).then(res, rej);
    return c;
  };
  return { db: { select: () => chain() }, users: table("users"), follows: table("follows"), closeFriends: table("close_friends") };
});

import { PgDialect } from "drizzle-orm/pg-core";
import {
  canViewerSeeProfileContent, closeFriendOfAuthor, isCloseFriendOf, normalizeCloseFriendIds,
  privateAuthorVisibleTo, viewerCanSeeContent, CLOSE_FRIENDS_MAX,
} from "./privateAccount";

const base = { viewerId: "v", ownerId: "o" };

describe("canViewerSeeProfileContent matrix", () => {
  const cases: Array<[string, Parameters<typeof canViewerSeeProfileContent>[0], boolean]> = [
    ["public, stranger", { ...base, ownerIsPrivate: false, viewerFollowsOwner: false }, true],
    ["public, follower", { ...base, ownerIsPrivate: false, viewerFollowsOwner: true }, true],
    ["public, signed out", { viewerId: null, ownerId: "o", ownerIsPrivate: false, viewerFollowsOwner: false }, true],
    ["private, non-follower", { ...base, ownerIsPrivate: true, viewerFollowsOwner: false }, false],
    ["private, follower", { ...base, ownerIsPrivate: true, viewerFollowsOwner: true }, true],
    ["private, owner", { viewerId: "o", ownerId: "o", ownerIsPrivate: true, viewerFollowsOwner: false }, true],
    ["private, signed out", { viewerId: null, ownerId: "o", ownerIsPrivate: true, viewerFollowsOwner: false }, false],
    ["private, admin", { ...base, ownerIsPrivate: true, viewerFollowsOwner: false, viewerIsAdmin: true }, true],
    ["public, blocked", { ...base, ownerIsPrivate: false, viewerFollowsOwner: false, blocked: true }, false],
    ["private, follower but blocked", { ...base, ownerIsPrivate: true, viewerFollowsOwner: true, blocked: true }, false],
    ["private, owner but blocked flag", { viewerId: "o", ownerId: "o", ownerIsPrivate: true, viewerFollowsOwner: false, blocked: true }, false],
  ];
  it.each(cases)("%s", (_n, input, expected) => {
    expect(canViewerSeeProfileContent(input)).toBe(expected);
  });
});

describe("viewerCanSeeContent (db-backed)", () => {
  it("owner always sees without a query", async () => {
    expect(await viewerCanSeeContent("o", "o")).toBe(true);
  });
  it("public owner", async () => {
    rows.next = [[{ isPrivate: false }]];
    expect(await viewerCanSeeContent("v", "o")).toBe(true);
  });
  it("private owner, no follow edge", async () => {
    rows.next = [[{ isPrivate: true }], []];
    expect(await viewerCanSeeContent("v", "o")).toBe(false);
  });
  it("private owner, follow edge", async () => {
    rows.next = [[{ isPrivate: true }], [{ f: "v" }]];
    expect(await viewerCanSeeContent("v", "o")).toBe(true);
  });
  it("private owner, signed out", async () => {
    rows.next = [[{ isPrivate: true }]];
    expect(await viewerCanSeeContent(null, "o")).toBe(false);
  });
});

describe("SQL predicates", () => {
  const dialect = new PgDialect();
  it("anonymous predicate only excludes private authors", () => {
    const q = dialect.sqlToQuery(privateAuthorVisibleTo(null, "posts.user_id" as any));
    expect(q.sql).toContain("is_private = TRUE");
    expect(q.sql).not.toContain("follows");
  });
  it("viewer predicate allows self, public authors and followed authors", () => {
    const q = dialect.sqlToQuery(privateAuthorVisibleTo("viewer-1", "posts.user_id" as any));
    expect(q.sql).toContain("follows pf");
    expect(q.params).toContain("viewer-1");
  });
  it("close friend predicate checks close_friends", () => {
    const q = dialect.sqlToQuery(closeFriendOfAuthor("viewer-1", "s.author_id" as any));
    expect(q.sql).toContain("close_friends cf");
  });
});

describe("close friends helpers", () => {
  it("isCloseFriendOf", async () => {
    expect(await isCloseFriendOf("a", "a")).toBe(true);
    rows.next = [[{ f: "b" }]];
    expect(await isCloseFriendOf("a", "b")).toBe(true);
    rows.next = [[]];
    expect(await isCloseFriendOf("a", "c")).toBe(false);
  });
  it("normalizeCloseFriendIds dedupes and drops the owner", () => {
    expect(normalizeCloseFriendIds(["a", "a", "me", "b"], "me")).toEqual(["a", "b"]);
  });
  it("rejects non-arrays, bad entries, and lists over the cap", () => {
    expect(normalizeCloseFriendIds("a", "me")).toBeNull();
    expect(normalizeCloseFriendIds([1], "me")).toBeNull();
    expect(normalizeCloseFriendIds([""], "me")).toBeNull();
    const big = Array.from({ length: CLOSE_FRIENDS_MAX + 1 }, (_, i) => `u${i}`);
    expect(normalizeCloseFriendIds(big, "me")).toBeNull();
    expect(normalizeCloseFriendIds(big.slice(0, CLOSE_FRIENDS_MAX), "me")).toHaveLength(CLOSE_FRIENDS_MAX);
  });
});
