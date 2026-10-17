import { describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("@workspace/db", () => ({ db: { execute: (...args: unknown[]) => execute(...args) } }));

import { getStoreLanguage, isStoreLanguage, normalizeStoreLanguage } from "./storeLanguage";

describe("store language", () => {
  it("only accepts the offered codes", () => {
    expect(isStoreLanguage("fr")).toBe(true);
    expect(isStoreLanguage("xx")).toBe(false);
    expect(isStoreLanguage(undefined)).toBe(false);
  });
  it("normalizes stored values to a safe tag", () => {
    expect(normalizeStoreLanguage("PT-br")).toBe("pt");
    expect(normalizeStoreLanguage('"><script>')).toBe("en");
    expect(normalizeStoreLanguage(null)).toBe("en");
  });
  it("reads seller_settings and falls back to en", async () => {
    execute.mockResolvedValueOnce({ rows: [{ store_language: "ja" }] });
    expect(await getStoreLanguage("seller_1")).toBe("ja");
    execute.mockResolvedValueOnce({ rows: [] });
    expect(await getStoreLanguage("seller_2")).toBe("en");
    execute.mockRejectedValueOnce(new Error("db down"));
    expect(await getStoreLanguage("seller_3")).toBe("en");
  });
});
