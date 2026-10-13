/**
 * Notes audience (POST /api/social/notes `audience`, GET
 * /api/social/notes/following filtering). Pure-function unit test of the
 * gate the route uses; the DB-backed route shape is covered by the social
 * integration suites (skipped without DATABASE_URL).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, follows: {}, closeFriends: {} }));

const { noteVisibleTo, parseNoteAudience, normalizeNoteAudience } = await import("../../lib/noteAudience");

const rel = (o: Partial<Record<"following" | "followedBy" | "closeFriendOf", string[]>>) => ({
  following: new Set(o.following ?? []),
  followedBy: new Set(o.followedBy ?? []),
  closeFriendOf: new Set(o.closeFriendOf ?? []),
});

describe("parseNoteAudience", () => {
  it("defaults a missing audience to 'followers' (the pre-audience behaviour)", () => {
    expect(parseNoteAudience(undefined)).toBe("followers");
    expect(parseNoteAudience(null)).toBe("followers");
    expect(parseNoteAudience("")).toBe("followers");
  });

  it("accepts the two Instagram audiences", () => {
    expect(parseNoteAudience("friends")).toBe("friends");
    expect(parseNoteAudience("close_friends")).toBe("close_friends");
  });

  it("rejects anything else", () => {
    expect(parseNoteAudience("everyone")).toBeNull();
    expect(parseNoteAudience(["friends"])).toBeNull();
    expect(parseNoteAudience(1)).toBeNull();
  });
});

describe("normalizeNoteAudience", () => {
  it("reads legacy or unknown stored values as 'followers'", () => {
    expect(normalizeNoteAudience(null)).toBe("followers");
    expect(normalizeNoteAudience("public")).toBe("followers");
    expect(normalizeNoteAudience("close_friends")).toBe("close_friends");
  });
});

describe("noteVisibleTo", () => {
  const author = "author";
  const viewer = "viewer";

  it("always shows the author their own note", () => {
    expect(noteVisibleTo("close_friends", author, author, rel({}))).toBe(true);
  });

  it("'followers' notes pass for a follower", () => {
    expect(noteVisibleTo("followers", author, viewer, rel({ following: [author] }))).toBe(true);
  });

  it("'friends' notes need a mutual follow", () => {
    expect(noteVisibleTo("friends", author, viewer, rel({ following: [author] }))).toBe(false);
    expect(noteVisibleTo("friends", author, viewer, rel({ following: [author], followedBy: [author] }))).toBe(true);
  });

  it("'close_friends' notes need the viewer on the author's list", () => {
    expect(noteVisibleTo("close_friends", author, viewer, rel({ following: [author], followedBy: [author] }))).toBe(false);
    expect(noteVisibleTo("close_friends", author, viewer, rel({ following: [author], closeFriendOf: [author] }))).toBe(true);
  });
});
