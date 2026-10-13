import { describe, expect, it } from "vitest";
import { interleaveByAuthor, parseFollowedFreshQuery } from "./followedFresh";

const row = (id: string, userId: string) => ({ id, userId });
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

describe("interleaveByAuthor", () => {
  it("keeps newest-first order when no brand runs past two", () => {
    const rows = [row("1", "a"), row("2", "a"), row("3", "b"), row("4", "a")];
    expect(ids(interleaveByAuthor(rows))).toEqual(["1", "2", "3", "4"]);
  });

  it("pulls the next other brand forward after two in a row", () => {
    const rows = [row("1", "a"), row("2", "a"), row("3", "a"), row("4", "a"), row("5", "b"), row("6", "c")];
    expect(ids(interleaveByAuthor(rows))).toEqual(["1", "2", "5", "3", "4", "6"]);
  });

  it("defers posts that could only extend a run past the cap", () => {
    const rows = [row("1", "a"), row("2", "a"), row("3", "a"), row("4", "b")];
    expect(ids(interleaveByAuthor(rows))).toEqual(["1", "2", "4", "3"]);
    expect(ids(interleaveByAuthor([row("1", "a"), row("2", "a"), row("3", "a")]))).toEqual(["1", "2"]);
  });

  it("returns an empty list for no rows", () => {
    expect(interleaveByAuthor([])).toEqual([]);
  });
});

describe("parseFollowedFreshQuery", () => {
  it("defaults to 20 posts over 72 hours", () => {
    expect(parseFollowedFreshQuery({})).toEqual({ limit: 20, hours: 72 });
    expect(parseFollowedFreshQuery({ limit: "abc", hours: [] })).toEqual({ limit: 20, hours: 72 });
  });

  it("clamps out-of-range values", () => {
    expect(parseFollowedFreshQuery({ limit: "500", hours: "9999" })).toEqual({ limit: 30, hours: 168 });
    expect(parseFollowedFreshQuery({ limit: "0", hours: "-4" })).toEqual({ limit: 1, hours: 1 });
  });
});
