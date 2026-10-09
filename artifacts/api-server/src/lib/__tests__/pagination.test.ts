import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_PAGE_LIMIT,
  MAX_LIST_LIMIT,
  MAX_PAGE_LIMIT,
  finishListPage,
  paginationMetadata,
  parseListPage,
  parsePagination,
} from "../pagination";

describe("shared pagination", () => {
  it("uses bounded defaults and coerces valid strings", () => {
    const defaults = parsePagination({});
    expect(defaults.success && defaults.data).toEqual({
      limit: DEFAULT_PAGE_LIMIT,
      offset: 0,
    });
    expect(parsePagination({ limit: "25", offset: "50" })).toEqual({
      success: true,
      data: { limit: 25, offset: 50 },
    });
  });

  it("rejects negative, invalid, and over-maximum values", () => {
    expect(parsePagination({ limit: 0 }).success).toBe(false);
    expect(parsePagination({ offset: -1 }).success).toBe(false);
    expect(parsePagination({ limit: MAX_PAGE_LIMIT + 1 }).success).toBe(false);
    expect(parsePagination({ limit: "nope" }).success).toBe(false);
  });

  it("reports empty, final, and continuing pages", () => {
    expect(paginationMetadata({ limit: 20, offset: 0 }, 0, 0).hasMore).toBe(false);
    expect(paginationMetadata({ limit: 20, offset: 20 }, 20, 40).hasMore).toBe(false);
    expect(paginationMetadata({ limit: 20, offset: 20 }, 20, 41).hasMore).toBe(true);
  });
});
describe("opt-in list pagination (legacy unbounded endpoints)", () => {
  it("defaults when no params are sent", () => {
    expect(parseListPage({})).toEqual({ limit: DEFAULT_LIST_LIMIT, offset: 0 });
    expect(parseListPage(undefined, { defaultLimit: 500, maxLimit: 500 })).toEqual({ limit: 500, offset: 0 });
  });

  it("honors explicit values and clamps instead of rejecting", () => {
    expect(parseListPage({ limit: "25", offset: "50" })).toEqual({ limit: 25, offset: 50 });
    expect(parseListPage({ limit: "99999" })).toEqual({ limit: MAX_LIST_LIMIT, offset: 0 });
    expect(parseListPage({ limit: "7.9", offset: "3.2" })).toEqual({ limit: 7, offset: 3 });
    expect(parseListPage({ limit: ["5", "9"] })).toEqual({ limit: 5, offset: 0 });
  });

  it("falls back to defaults for garbage", () => {
    for (const bad of [{ limit: "abc" }, { limit: "0" }, { limit: "-4" }, { limit: "" }]) {
      expect(parseListPage(bad, { defaultLimit: 50 }).limit).toBe(50);
    }
    expect(parseListPage({ offset: "-1" }).offset).toBe(0);
    expect(parseListPage({ offset: "nope" }).offset).toBe(0);
  });

  it("never lets the default exceed the max", () => {
    expect(parseListPage({}, { defaultLimit: 1000, maxLimit: 10 }).limit).toBe(10);
  });

  it("finishListPage drops the probe row and sets headers", () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as any;
    expect(finishListPage(res, { limit: 2, offset: 4 }, [1, 2, 3])).toEqual([1, 2]);
    expect(headers).toEqual({
      "X-Pagination-Limit": "2",
      "X-Pagination-Offset": "4",
      "X-Pagination-Returned": "2",
      "X-Pagination-Has-More": "true",
    });
    expect(finishListPage(res, { limit: 2, offset: 0 }, [1])).toEqual([1]);
    expect(headers["X-Pagination-Has-More"]).toBe("false");
    expect(headers["X-Pagination-Returned"]).toBe("1");
  });
});
