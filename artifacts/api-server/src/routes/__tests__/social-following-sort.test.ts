/**
 * GET /api/social/following's `?sort=` mapping — the Following list's "Sort
 * by" bottom sheet (Default / Date followed: latest / Date followed:
 * earliest). Pure-function unit test: the direction mapping itself needs no
 * database, unlike the route handler around it (see
 * social-follow-lists.integration.test.ts for the DB-backed request/response
 * shape, skipped in this sandbox per the documented DATABASE_URL constraint).
 */
import { describe, expect, it } from "vitest";
import { followingSortDirection } from "../../lib/followingSort";

describe("followingSortDirection", () => {
  it("defaults to most-recently-followed-first", () => {
    expect(followingSortDirection(undefined)).toBe("desc");
    expect(followingSortDirection("default")).toBe("desc");
  });

  it("'latest' is the same order as default", () => {
    expect(followingSortDirection("latest")).toBe("desc");
  });

  it("'earliest' reverses to oldest-followed-first", () => {
    expect(followingSortDirection("earliest")).toBe("asc");
  });

  it("ignores unknown values instead of throwing", () => {
    expect(followingSortDirection("bogus")).toBe("desc");
    expect(followingSortDirection(["earliest"])).toBe("desc");
  });
});
