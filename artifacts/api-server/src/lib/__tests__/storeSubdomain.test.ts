import { describe, expect, it } from "vitest";
import {
  buildSubdomainState,
  RESERVED_SUBDOMAINS,
  subdomainFromHandle,
  validateSubdomain,
} from "../storeSubdomain";

describe("validateSubdomain", () => {
  it.each(["abc", "noire", "atelier-noire", "a1-b2", "a".repeat(63), "store-1a2b3c4d"])("accepts %s", v => {
    expect(validateSubdomain(v)).toEqual({ ok: true, subdomain: v });
  });

  it("trims and lowercases", () => {
    expect(validateSubdomain("  Noire ")).toEqual({ ok: true, subdomain: "noire" });
  });

  it.each([
    [undefined, "required"],
    [42, "required"],
    ["   ", "required"],
    ["ab", "too_short"],
    ["a".repeat(64), "too_long"],
    ["no_ire", "invalid_characters"],
    ["noire.shop", "invalid_characters"],
    ["noïre", "invalid_characters"],
    ["-noire", "hyphen_edge"],
    ["noire-", "hyphen_edge"],
    ["www", "reserved"],
    ["API", "reserved"],
    ["brandthread", "reserved"],
  ])("rejects %s as %s", (v, error) => {
    const r = validateSubdomain(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(error);
      expect(r.message).toBeTruthy();
    }
  });

  it("reserves the platform names from the spec", () => {
    for (const name of ["www", "api", "admin", "app", "mail", "help", "support", "brandthread"]) {
      expect(RESERVED_SUBDOMAINS.has(name)).toBe(true);
    }
  });
});

describe("subdomainFromHandle", () => {
  it.each([
    ["@Atelier Noire", "atelier-noire"],
    ["atelier_noire", "atelier-noire"],
    ["Café Ü", "cafe-u"],
    ["--x--y--", "x-y"],
    ["--x--", null],
    ["ab", null],
    ["www", null],
    ["", null],
    [null, null],
  ])("%s -> %s", (input, expected) => {
    expect(subdomainFromHandle(input)).toBe(expected);
  });

  it("caps long handles at 63 chars without a trailing hyphen", () => {
    const out = subdomainFromHandle(`${"a".repeat(62)} bcd`);
    expect(out).toBe("a".repeat(62));
  });
});

describe("buildSubdomainState", () => {
  it("unclaimed -> no subdomain, keeps suggestion", () => {
    expect(buildSubdomainState({ slug: "store-1", subdomainClaimedAt: null }, "noire")).toEqual({
      subdomain: null, status: "unclaimed", assignedSlug: "store-1", suggestion: "noire", url: null, claimedAt: null,
    });
  });

  it("claimed -> active", () => {
    expect(buildSubdomainState({ slug: "noire", subdomainClaimedAt: "2026-05-01T00:00:00Z" }, "x")).toEqual({
      subdomain: "noire", status: "active", assignedSlug: "noire", suggestion: null,
      url: "https://noire.brandthread.app", claimedAt: "2026-05-01T00:00:00.000Z",
    });
  });
});
