import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  paginationMetadata,
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