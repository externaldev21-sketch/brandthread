import { describe, expect, it } from "vitest";
import {
  MAX_CONTACT_HASHES, contactSyncEnabled, hashContact, isValidContactHash,
  normalizeEmail, normalizePhone, parseHashList, resolveMatchedUserIds,
} from "../contactHashes";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => expect(normalizeEmail("  Ana.Lopez@Example.COM ")).toBe("ana.lopez@example.com"));
  it("rejects malformed values", () => {
    for (const v of ["", "nope", "a@b", "a b@c.com", null, undefined]) expect(normalizeEmail(v as any)).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("formats US national numbers to E.164", () => {
    expect(normalizePhone("(415) 555-0134")).toBe("+14155550134");
    expect(normalizePhone("415.555.0134")).toBe("+14155550134");
    expect(normalizePhone("1 415 555 0134")).toBe("+14155550134");
  });
  it("keeps explicit international numbers", () => {
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("0044 7700 900123")).toBe("+447700900123");
  });
  it("uses the provided default calling code", () => expect(normalizePhone("07700 900123", "44")).toBe("+447700900123"));
  it("rejects too short / empty", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("hashContact", () => {
  // Shared vectors: artifacts/mobile/lib/contactHashing.test.ts asserts the same digests.
  it("matches the cross-platform test vectors", () => {
    expect(hashContact("email", "ana@example.com")).toBe("cabe5354bebcc6dde8ae88dcf0001bbe4b9e06a09eb1df023d6c373c51cf114d");
    expect(hashContact("phone", "+14155550134")).toBe("b91f7f4aea7b5b4425b31b3b81ccd77fe36bffae2df7a884b13f70808893933b");
  });
  it("is deterministic and kind-separated", () => {
    expect(hashContact("email", "a@b.co")).toBe(hashContact("email", "a@b.co"));
    expect(hashContact("email", "+14155550134")).not.toBe(hashContact("phone", "+14155550134"));
  });
});

describe("parseHashList", () => {
  const h = hashContact("email", "a@b.co");
  it("accepts and dedupes valid hashes", () => {
    expect(parseHashList([h, h])).toEqual({ ok: true, hashes: [h] });
  });
  it("accepts an empty list", () => expect(parseHashList([])).toEqual({ ok: true, hashes: [] }));
  it("rejects non-arrays and non-hex entries", () => {
    expect(parseHashList("x")).toMatchObject({ ok: false, status: 400 });
    expect(parseHashList(["ana@example.com"])).toMatchObject({ ok: false, status: 400 });
    expect(parseHashList([h.toUpperCase()])).toMatchObject({ ok: false, status: 400 });
  });
  it("enforces the 2000 hash limit", () => {
    const many = Array.from({ length: MAX_CONTACT_HASHES + 1 }, (_, i) => hashContact("phone", `+1415555${String(i).padStart(4, "0")}`));
    expect(parseHashList(many)).toMatchObject({ ok: false, status: 413 });
    expect(parseHashList(many.slice(0, MAX_CONTACT_HASHES))).toMatchObject({ ok: true });
  });
  it("isValidContactHash checks shape", () => {
    expect(isValidContactHash(h)).toBe(true);
    expect(isValidContactHash("abc")).toBe(false);
    expect(isValidContactHash(5)).toBe(false);
  });
});

describe("resolveMatchedUserIds", () => {
  it("drops self, blocked users and duplicates, preserving order", () => {
    const ids = resolveMatchedUserIds(
      [{ userId: "me" }, { userId: "u1" }, { userId: "blocked" }, { userId: "u2" }, { userId: "u1" }],
      "me", new Set(["blocked"]),
    );
    expect(ids).toEqual(["u1", "u2"]);
  });
});

describe("contactSyncEnabled", () => {
  it("defaults off and only enables on explicit truthy values", () => {
    expect(contactSyncEnabled({} as any)).toBe(false);
    expect(contactSyncEnabled({ CONTACT_SYNC_ENABLED: "0" } as any)).toBe(false);
    expect(contactSyncEnabled({ CONTACT_SYNC_ENABLED: "true" } as any)).toBe(true);
    expect(contactSyncEnabled({ CONTACT_SYNC_ENABLED: "1" } as any)).toBe(true);
  });
});
