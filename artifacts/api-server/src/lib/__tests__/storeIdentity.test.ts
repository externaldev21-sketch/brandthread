import { describe, expect, it } from "vitest";
import {
  containsProfanity,
  normalizeSocialLink,
  normalizeStoreAccent,
  validateBrandName,
  validateHandle,
} from "../storeIdentity";

describe("containsProfanity", () => {
  it.each(["fuck", "sh1t", "f.u.c.k", "FUUUCK", "fuckboyclothing", "b!tch", "a$$hole", "my_shit_store", "Bullsh1t Co"])(
    "blocks %s",
    (value) => expect(containsProfanity(value)).toBe(true),
  );

  it.each(["Scunthorpe", "Scunthorpe United", "class", "peacock", "Dickens", "cocktail", "Essex", "therapist", "analyst", "Matsushita", "shiitake", "Assembly", "Hancock", "Pedometer", "Niger"])(
    "allows %s",
    (value) => expect(containsProfanity(value)).toBe(false),
  );

  it("blocks standalone words but not the words that contain them", () => {
    expect(containsProfanity("ass")).toBe(true);
    expect(containsProfanity("big cock")).toBe(true);
    expect(containsProfanity("dick_shop")).toBe(true);
    expect(containsProfanity("assets")).toBe(false);
    expect(containsProfanity("cocktails")).toBe(false);
  });
});

describe("validateHandle", () => {
  it("lowercases and strips a leading @", () => {
    expect(validateHandle("@Studio_One")).toEqual({ handle: "studio_one", problem: null });
  });

  it("rejects bad formats", () => {
    expect(validateHandle("").problem?.code).toBe("INVALID");
    expect(validateHandle("ab").problem?.code).toBe("INVALID");
    expect(validateHandle("has space").problem?.code).toBe("INVALID");
    expect(validateHandle("dots.not.ok").problem?.code).toBe("INVALID");
    expect(validateHandle("a".repeat(31)).problem?.code).toBe("INVALID");
  });

  it("rejects reserved handles and platform impersonation", () => {
    for (const h of ["admin", "Admin", "support", "brandthread", "brand_thread", "brandthread_support", "b_r_a_n_d_thread", "ADMIN"]) {
      expect(validateHandle(h).problem?.code, h).toBe("RESERVED");
    }
  });

  it("rejects profanity including leetspeak", () => {
    expect(validateHandle("sh1tshop").problem?.code).toBe("BLOCKED");
    expect(validateHandle("scunthorpe_fc").problem).toBeNull();
  });
});

describe("validateBrandName", () => {
  it("collapses whitespace", () => {
    expect(validateBrandName("  Night   Owl ")).toEqual({ name: "Night Owl", problem: null });
  });

  it("rejects too short, too long and symbol-only names", () => {
    expect(validateBrandName("a").problem?.code).toBe("INVALID");
    expect(validateBrandName("x".repeat(51)).problem?.code).toBe("INVALID");
    expect(validateBrandName("!!!").problem?.code).toBe("INVALID");
    expect(validateBrandName("<b>Shop</b>").problem?.code).toBe("INVALID");
  });

  it("rejects reserved and profane names", () => {
    expect(validateBrandName("Brandthread Official").problem?.code).toBe("RESERVED");
    expect(validateBrandName("Support").problem?.code).toBe("RESERVED");
    expect(validateBrandName("F u c k Wear").problem?.code).toBe("BLOCKED");
    expect(validateBrandName("Scunthorpe Denim").problem).toBeNull();
  });
});

describe("normalizeStoreAccent", () => {
  it("accepts only the monochrome allowlist, case-insensitively", () => {
    expect(normalizeStoreAccent("#c0c0c0")).toBe("#C0C0C0");
    expect(normalizeStoreAccent("#000000")).toBe("#000000");
    expect(normalizeStoreAccent("#ff0000")).toBeNull();
    expect(normalizeStoreAccent("red")).toBeNull();
    expect(normalizeStoreAccent(null)).toBeNull();
  });
});

describe("normalizeSocialLink", () => {
  it("turns handles into canonical urls", () => {
    expect(normalizeSocialLink("instagram", "@Studio.One")).toBe("https://www.instagram.com/studio.one");
    expect(normalizeSocialLink("tiktok", "studio_one")).toBe("https://www.tiktok.com/@studio_one");
  });

  it("canonicalises profile urls", () => {
    expect(normalizeSocialLink("instagram", "https://instagram.com/studio/?hl=en")).toBe("https://www.instagram.com/studio");
    expect(normalizeSocialLink("instagram", "m.instagram.com/studio")).toBe("https://www.instagram.com/studio");
    expect(normalizeSocialLink("tiktok", "http://www.tiktok.com/@studio?lang=en")).toBe("https://www.tiktok.com/@studio");
  });

  it("clears on empty input", () => {
    expect(normalizeSocialLink("instagram", "  ")).toBe("");
    expect(normalizeSocialLink("tiktok", undefined)).toBe("");
  });

  it("rejects other domains, lookalikes and malformed values", () => {
    expect(normalizeSocialLink("instagram", "https://evil.com/studio")).toBeNull();
    expect(normalizeSocialLink("instagram", "https://instagram.com.evil.com/studio")).toBeNull();
    expect(normalizeSocialLink("instagram", "https://evilinstagram.com/studio")).toBeNull();
    expect(normalizeSocialLink("instagram", "https://tiktok.com/@studio")).toBeNull();
    expect(normalizeSocialLink("tiktok", "https://user:pw@tiktok.com/@studio")).toBeNull();
    expect(normalizeSocialLink("instagram", "javascript:alert(1)//x")).toBeNull();
    expect(normalizeSocialLink("instagram", "https://instagram.com/")).toBeNull();
    expect(normalizeSocialLink("instagram", "bad handle")).toBeNull();
    expect(normalizeSocialLink("tiktok", "a")).toBeNull();
  });
});
