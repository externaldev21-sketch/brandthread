import { describe, expect, it } from "vitest";
import { UTM_PRESETS, buildDestinationUrl, parseUtmFromUrl, sanitizeUtm, sanitizeUtmValue, validateLinkInput } from "../utm";

describe("UTM sanitising", () => {
  it("lowercases and strips unsafe characters", () => {
    expect(sanitizeUtmValue("  Summer Sale 2026!! ")).toBe("summer-sale-2026");
    expect(sanitizeUtmValue("<script>alert(1)</script>")).toBe("script-alert-1-script");
    expect(sanitizeUtmValue("a&utm_medium=x")).toBe("a-utm_medium-x");
    expect(sanitizeUtmValue("   ")).toBeNull();
    expect(sanitizeUtmValue(null)).toBeNull();
    expect(sanitizeUtmValue("x".repeat(200))).toHaveLength(80);
  });
  it("has presets that are already valid", () => {
    for (const p of UTM_PRESETS) {
      expect(sanitizeUtmValue(p.source)).toBe(p.source);
      expect(sanitizeUtmValue(p.medium)).toBe(p.medium);
    }
  });
});

describe("building and parsing", () => {
  const utm = sanitizeUtm({ source: "instagram", medium: "social", campaign: "Drop 01" });
  it("appends utm params and the link code, preserving existing params", () => {
    const url = buildDestinationUrl("https://brandthread.app/u/acme?ref=friend", utm, "abcd2345");
    const u = new URL(url);
    expect(u.searchParams.get("ref")).toBe("friend");
    expect(u.searchParams.get("utm_source")).toBe("instagram");
    expect(u.searchParams.get("utm_medium")).toBe("social");
    expect(u.searchParams.get("utm_campaign")).toBe("drop-01");
    expect(u.searchParams.get("bt_lc")).toBe("abcd2345");
    expect(u.searchParams.has("utm_term")).toBe(false);
  });
  it("overrides a same-named param on the destination", () => {
    const u = new URL(buildDestinationUrl("https://x.test/?utm_source=old", utm));
    expect(u.searchParams.get("utm_source")).toBe("instagram");
  });
  it("round-trips through parseUtmFromUrl", () => {
    const parsed = parseUtmFromUrl(buildDestinationUrl("https://x.test/p", utm, "abcd2345"));
    expect(parsed.utm).toEqual({ source: "instagram", medium: "social", campaign: "drop-01", term: null, content: null });
    expect(parsed.linkCode).toBe("abcd2345");
  });
  it("parses bare query strings and ignores junk", () => {
    expect(parseUtmFromUrl("?utm_source=Email&bt_lc=not!valid").linkCode).toBeNull();
    expect(parseUtmFromUrl("utm_source=Email").utm.source).toBe("email");
    expect(parseUtmFromUrl("").utm.source).toBeNull();
  });
});

describe("validateLinkInput", () => {
  const id = "0b9f5a7e-0f3c-4f0e-9f7e-2f6d3d1a7a11";
  it("accepts store / bio / product", () => {
    expect(validateLinkInput({ destinationType: "store", utmSource: "tiktok", utmMedium: "social" }).ok).toBe(true);
    expect(validateLinkInput({ destinationType: "bio", utmSource: "tiktok", utmMedium: "social" }).ok).toBe(true);
    const p = validateLinkInput({ destinationType: "product", destinationRef: id.toUpperCase(), utmSource: "a", utmMedium: "b", label: "  Bio link " });
    expect(p.ok && p.value.destinationRef).toBe(id);
    expect(p.ok && p.value.label).toBe("Bio link");
  });
  it("rejects bad input", () => {
    expect(validateLinkInput({ destinationType: "evil", utmSource: "a", utmMedium: "b" }).ok).toBe(false);
    expect(validateLinkInput({ destinationType: "product", destinationRef: "nope", utmSource: "a", utmMedium: "b" }).ok).toBe(false);
    expect(validateLinkInput({ destinationType: "store", utmMedium: "b" }).ok).toBe(false);
    expect(validateLinkInput({ destinationType: "store", utmSource: "a" }).ok).toBe(false);
    expect(validateLinkInput(null).ok).toBe(false);
  });
});
